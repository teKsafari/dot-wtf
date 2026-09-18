import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';
import { logAction } from '@/lib/action-logger';
import { getEmailTemplate } from '@/lib/email-templates';

const updateSubmissionSchema = z
  .object({
    id: z.number().int().positive(),
    action: z.enum(['approve', 'waitlist', 'archive', 'restore']),
  })
  .strict();

type SubmissionAction = z.infer<typeof updateSubmissionSchema>['action'];

const auditActions: Record<SubmissionAction, string> = {
  approve: 'approved',
  waitlist: 'waitlisted',
  archive: 'archived',
  restore: 'restored',
};

export async function GET() {
  try {
    const session = await auth();

    if (
      !session?.user ||
      (session.user.role !== 'admin' && session.user.role !== 'super_admin')
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allSubmissions = await db
      .select()
      .from(submissions)
      .orderBy(desc(submissions.createdAt));

    return NextResponse.json(allSubmissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();

    if (
      !session?.user ||
      (session.user.role !== 'admin' && session.user.role !== 'super_admin')
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = updateSubmissionSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid submission update' },
        { status: 400 }
      );
    }

    const { id, action } = parsedBody.data;
    const updatedAt = new Date();
    const updateValues:
      | { isApproved: boolean; updatedAt: Date }
      | { archivedAt: Date | null; updatedAt: Date } =
      action === 'approve'
        ? { isApproved: true, updatedAt }
        : action === 'waitlist'
          ? { isApproved: false, updatedAt }
          : action === 'archive'
            ? { archivedAt: updatedAt, updatedAt }
            : { archivedAt: null, updatedAt };
    const transitionCondition =
      action === 'approve'
        ? and(
            eq(submissions.id, id),
            isNull(submissions.archivedAt),
            or(
              isNull(submissions.isApproved),
              eq(submissions.isApproved, false)
            )
          )
        : action === 'waitlist'
          ? and(
              eq(submissions.id, id),
              isNull(submissions.archivedAt),
              isNull(submissions.isApproved)
            )
          : action === 'archive'
            ? and(
                eq(submissions.id, id),
                isNull(submissions.archivedAt)
              )
            : and(
                eq(submissions.id, id),
                isNotNull(submissions.archivedAt)
              );

    const [updatedSubmission] = await db
      .update(submissions)
      .set(updateValues)
      .where(transitionCondition)
      .returning();

    if (!updatedSubmission) {
      const [existingSubmission] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(eq(submissions.id, id))
        .limit(1);

      return NextResponse.json(
        {
          error: existingSubmission
            ? 'Action is not valid for this submission state'
            : 'Submission not found',
        },
        { status: existingSubmission ? 409 : 404 }
      );
    }

    const auditAction = auditActions[action];
    await logAction(
      id,
      auditAction,
      `Submission ${auditAction} via admin panel`
    );

    // Note: In a real app, you'd integrate with an email service like SendGrid, Resend, etc.
    // For now, we'll just log what email would be sent
    if (action === 'approve' || action === 'waitlist') {
      const emailTemplate = getEmailTemplate(
        action === 'approve' ? 'approved' : 'waitlisted',
        updatedSubmission.name
      );

      console.log(`Would send email to ${updatedSubmission.email}:`);
      console.log('Subject:', emailTemplate.subject);
      console.log('Body:', emailTemplate.text);

      await logAction(
        id,
        'email_queued',
        `${auditAction} email queued for ${updatedSubmission.email}`
      );
    }

    return NextResponse.json(updatedSubmission);
  } catch (error) {
    console.error('Error updating submission:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
