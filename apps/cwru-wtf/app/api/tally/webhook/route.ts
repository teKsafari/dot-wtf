import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { actionLogs, submissions } from '@/lib/schema';
import {
  parseTallyFieldKeys,
  parseTallyWebhook,
  TallyWebhookError,
  type ParsedTallySubmission,
  verifyTallySignature,
} from '@/lib/tally-webhook';

export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

type PersistenceResult =
  | { status: 'created'; submissionId: number }
  | { status: 'duplicate_submission' | 'duplicate_email' };

function safeErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,32}$/i.test(error.code)
  ) {
    return error.code;
  }

  return 'unknown';
}

class WebhookBodyTooLargeError extends Error {}

async function readWebhookBody(request: Request) {
  const declaredLength = request.headers.get('content-length')?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (
      Number.isSafeInteger(parsedLength) &&
      parsedLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      throw new WebhookBodyTooLargeError();
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        throw new WebhookBodyTooLargeError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return rawBody;
}

async function persistTallySubmission(
  submission: ParsedTallySubmission
): Promise<PersistenceResult> {
  const submittedAt = new Date(submission.submittedAt);

  return db.transaction(async (transaction) => {
    // The external submission ID makes retries idempotent. The transaction
    // lock also serializes distinct Tally deliveries for the same email, so a
    // check followed by an insert cannot create two applications concurrently.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${submission.email}, 0))`
    );

    const [existingSubmission] = await transaction
      .select({
        id: submissions.id,
        tallySubmissionId: submissions.tallySubmissionId,
      })
      .from(submissions)
      .where(sql`lower(${submissions.email}) = ${submission.email}`)
      .limit(1);

    if (existingSubmission) {
      return {
        status:
          existingSubmission.tallySubmissionId ===
          submission.tallySubmissionId
            ? 'duplicate_submission'
            : 'duplicate_email',
      };
    }

    const [createdSubmission] = await transaction
      .insert(submissions)
      .values({
        name: submission.name,
        email: submission.email,
        whatsapp: submission.whatsapp,
        categories: JSON.stringify(submission.categories),
        otherCategory: submission.otherCategory,
        wtfIdea: submission.wtfIdea,
        currentProject: submission.currentProject,
        youtubeLink: submission.youtubeLink,
        tallySubmissionId: submission.tallySubmissionId,
        interests: null,
        isApproved: null,
        archivedAt: null,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      })
      .onConflictDoNothing({ target: submissions.tallySubmissionId })
      .returning({ id: submissions.id });

    if (!createdSubmission) {
      return { status: 'duplicate_submission' };
    }

    return { status: 'created', submissionId: createdSubmission.id };
  });
}

async function logTallySubmission(submissionId: number) {
  try {
    await db.insert(actionLogs).values({
      submissionId,
      action: 'submitted',
      details: 'New Tally submission received',
    });
  } catch (error) {
    // Audit logging remains best effort. Never pass the database error object to
    // the logger because query parameters can contain applicant information.
    console.error(
      `Unable to store Tally audit event (code: ${safeErrorCode(error)})`
    );
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.TALLY_WEBHOOK_SECRET;
  const expectedFormId = process.env.TALLY_FORM_ID;
  const fieldKeys = parseTallyFieldKeys(process.env.TALLY_FIELD_KEYS);

  if (!webhookSecret || !expectedFormId || !fieldKeys) {
    console.error('Tally webhook environment is not configured');
    return NextResponse.json(
      { error: 'Webhook is not configured' },
      { status: 503 }
    );
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await readWebhookBody(request);
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return NextResponse.json(
        { error: 'Webhook payload is too large' },
        { status: 413 }
      );
    }

    console.warn('Unable to read Tally webhook request body');
    return NextResponse.json(
      { error: 'Invalid Tally webhook payload' },
      { status: 400 }
    );
  }

  const signature = request.headers.get('tally-signature');

  if (!verifyTallySignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 401 }
    );
  }

  let submission: ParsedTallySubmission;
  try {
    submission = parseTallyWebhook(rawBody, expectedFormId, fieldKeys);
  } catch (error) {
    if (error instanceof TallyWebhookError) {
      console.warn('Rejected Tally webhook payload:', error.code);
      return NextResponse.json(
        { error: 'Invalid Tally webhook payload' },
        { status: error.code === 'unexpected_form' ? 403 : 400 }
      );
    }

    console.error('Unable to parse Tally webhook payload');
    return NextResponse.json(
      { error: 'Invalid Tally webhook payload' },
      { status: 400 }
    );
  }

  try {
    const result = await persistTallySubmission(submission);

    if (result.status === 'created') {
      // Audit logging is best effort and intentionally outside the capture
      // transaction. A missing logging table must not make Tally retry an
      // application that was already stored successfully.
      await logTallySubmission(result.submissionId);

      return NextResponse.json(
        { ok: true, status: result.status },
        { status: 201 }
      );
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    console.error(
      `Unable to store Tally submission (code: ${safeErrorCode(error)})`
    );
    return NextResponse.json(
      { error: 'Unable to store Tally submission' },
      { status: 500 }
    );
  }
}
