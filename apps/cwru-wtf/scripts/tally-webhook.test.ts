import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  parseTallyFieldKeys,
  parseTallyWebhook,
  TallyWebhookError,
  type TallyWebhookErrorCode,
  verifyTallySignature,
} from '../lib/tally-webhook';

const FORM_ID = 'lbp7OX';
const FIELD_KEYS = {
  name: 'question-name',
  email: 'question-email',
  whatsapp: 'question-whatsapp',
  categories: 'question-categories',
  otherCategory: 'question-other-category',
  wtfIdea: 'question-wtf-idea',
  currentProject: 'question-current-project',
  youtubeLink: 'question-video',
  otherCategoryOptionId: 'other-id',
} as const;

function parseWebhook(rawBody: string | Uint8Array, formId = FORM_ID) {
  return parseTallyWebhook(rawBody, formId, FIELD_KEYS);
}

function makePayload() {
  return {
    eventId: 'event-123',
    eventType: 'FORM_RESPONSE',
    createdAt: '1999-01-01T00:00:00.000Z',
    data: {
      submissionId: 'submission-123',
      responseId: 'submission-123',
      respondentId: 'respondent-123',
      formId: FORM_ID,
      formName: 'Klariti application',
      createdAt: '1999-01-01T00:00:00.000Z',
      fields: [
        {
          key: 'question-name',
          label: 'Name',
          type: 'INPUT_TEXT',
          value: '  Ada Lovelace  ',
        },
        {
          key: 'question-email',
          label: 'Email',
          type: 'INPUT_EMAIL',
          value: 'Ada@CASE.EDU',
        },
        {
          key: 'question-whatsapp',
          label: 'WhatsApp',
          type: 'INPUT_PHONE_NUMBER',
          value: '+1 (216) 555-0100',
        },
        {
          key: 'question-categories',
          label: 'What’s your thing?',
          type: 'CHECKBOXES',
          value: ['hardware-id', 'other-id'],
          options: [
            { id: 'photo-id', text: 'Photography / Film' },
            { id: 'hardware-id', text: 'Hardware / Electronics' },
            { id: 'other-id', text: 'Other' },
          ],
        },
        {
          key: 'question-category-hardware',
          label: "What's your thing? (Hardware / Electronics)",
          type: 'CHECKBOXES',
          value: true,
        },
        {
          key: 'question-other-category',
          label: 'Other category',
          type: 'INPUT_TEXT',
          value: '  Robotics  ',
        },
        {
          key: 'question-wtf-idea',
          label: 'Your WTF idea',
          type: 'TEXTAREA',
          value: 'Build a surprising machine.',
        },
        {
          key: 'question-current-project',
          label: 'Current project',
          type: 'TEXTAREA',
          value: 'A working prototype.',
        },
        {
          key: 'question-video',
          label: 'A video of something that interests you',
          type: 'INPUT_LINK',
          value: 'youtube.com/watch?v=dQw4w9WgXcQ',
        },
        {
          key: 'legacy-approval',
          label: 'isApproved',
          type: 'HIDDEN_FIELDS',
          value: true,
        },
        {
          key: 'legacy-created-at',
          label: 'createdAt',
          type: 'HIDDEN_FIELDS',
          value: '1999-01-01T00:00:00.000Z',
        },
      ],
    },
  };
}

function expectWebhookError(
  callback: () => unknown,
  expectedCode: TallyWebhookErrorCode
) {
  assert.throws(
    callback,
    (error: unknown) =>
      error instanceof TallyWebhookError && error.code === expectedCode
  );
}

test('verifies Tally HMAC against the exact raw body bytes', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify(makePayload(), null, 2);
  const signature = createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  assert.equal(verifyTallySignature(rawBody, signature, secret), true);
  assert.equal(
    verifyTallySignature(`${rawBody}\n`, signature, secret),
    false,
    'even insignificant JSON whitespace must change the signature'
  );
  assert.equal(
    verifyTallySignature(rawBody, `${signature}!`, secret),
    false,
    'a non-canonical base64 header must be rejected'
  );
  assert.equal(verifyTallySignature(rawBody, 'not-base64', secret), false);
  assert.equal(verifyTallySignature(rawBody, null, secret), false);
});

test('maps the official Tally payload into a pending application', () => {
  const parsed = parseWebhook(Buffer.from(JSON.stringify(makePayload())));

  assert.deepEqual(parsed, {
    eventId: 'event-123',
    tallySubmissionId: 'submission-123',
    formId: FORM_ID,
    submittedAt: '1999-01-01T00:00:00.000Z',
    name: 'Ada Lovelace',
    email: 'ada@case.edu',
    whatsapp: '+1 (216) 555-0100',
    categories: ['Hardware / Electronics', 'Other'],
    otherCategory: 'Robotics',
    wtfIdea: 'Build a surprising machine.',
    currentProject: 'A working prototype.',
    youtubeLink: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.equal('isApproved' in parsed, false);
  assert.equal('createdAt' in parsed, false);
});

test('accepts Tally dashboard test deliveries without an eventType', () => {
  const payload = makePayload();
  const testDelivery = {
    eventId: payload.eventId,
    createdAt: payload.createdAt,
    data: payload.data,
  };

  assert.deepEqual(
    parseWebhook(JSON.stringify(testDelivery)),
    parseWebhook(JSON.stringify(payload))
  );

  testDelivery.data.formId = 'another-form';
  expectWebhookError(
    () => parseWebhook(JSON.stringify(testDelivery)),
    'unexpected_form'
  );

  testDelivery.data.formId = FORM_ID;
  testDelivery.data.fields = testDelivery.data.fields.filter(
    (field) => field.key !== FIELD_KEYS.email
  );
  expectWebhookError(
    () => parseWebhook(JSON.stringify(testDelivery)),
    'missing_field'
  );
});

test('ignores per-option CHECKBOXES booleans when mapping categories', () => {
  const payload = makePayload();
  const expected = parseWebhook(JSON.stringify(payload));
  payload.data.fields.unshift(
    {
      key: 'question-category-photo',
      label: "What's your thing? (Photography / Film)",
      type: 'CHECKBOXES',
      value: false,
    },
    {
      key: 'question-category-other',
      label: "What's your thing? (Other)",
      type: 'CHECKBOXES',
      value: true,
    }
  );

  assert.deepEqual(parseWebhook(JSON.stringify(payload)), expected);
});

test('does not retain an unanswered conditional Other category', () => {
  const payload = makePayload();
  const categories = payload.data.fields.find(
    (field) => field.key === 'question-categories'
  );
  assert(categories);
  categories.value = ['hardware-id'];

  const parsed = parseWebhook(JSON.stringify(payload));
  assert.deepEqual(parsed.categories, ['Hardware / Electronics']);
  assert.equal(parsed.otherCategory, null);
});

test('requires Other category when Other is selected', () => {
  const payload = makePayload();
  payload.data.fields = payload.data.fields.filter(
    (field) => field.key !== 'question-other-category'
  );

  expectWebhookError(
    () => parseWebhook(JSON.stringify(payload)),
    'missing_field'
  );
});

test('rejects an event for any form other than the configured form', () => {
  const payload = makePayload();
  payload.data.formId = 'another-form';

  expectWebhookError(
    () => parseWebhook(JSON.stringify(payload)),
    'unexpected_form'
  );
});

test('rejects unsupported event types and malformed payloads', () => {
  const payload = makePayload();
  payload.eventType = 'FORM_UPDATED';

  expectWebhookError(
    () => parseWebhook(JSON.stringify(payload)),
    'unexpected_event'
  );
  expectWebhookError(() => parseWebhook('{'), 'invalid_json');
  expectWebhookError(
    () => parseWebhook('{}'),
    'invalid_payload'
  );
});

test('maps by immutable field keys and rejects duplicate keys', () => {
  const renamedLabelPayload = makePayload();
  for (const field of renamedLabelPayload.data.fields) {
    field.label = `Renamed ${field.key}`;
  }
  const categories = renamedLabelPayload.data.fields.find(
    (field) => field.key === FIELD_KEYS.categories
  );
  assert(categories?.options);
  const otherOption = categories.options.find(
    (option) => option.id === FIELD_KEYS.otherCategoryOptionId
  );
  assert(otherOption);
  otherOption.text = 'Something else';

  const parsedRenamedPayload = parseWebhook(
    JSON.stringify(renamedLabelPayload)
  );
  assert.equal(parsedRenamedPayload.name, 'Ada Lovelace');
  assert.equal(parsedRenamedPayload.email, 'ada@case.edu');
  assert.deepEqual(parsedRenamedPayload.categories, [
    'Hardware / Electronics',
    'Other',
  ]);
  assert.equal(parsedRenamedPayload.otherCategory, 'Robotics');

  const duplicateKeyPayload = makePayload();
  duplicateKeyPayload.data.fields.push({
    key: FIELD_KEYS.name,
    label: 'Another question',
    type: 'INPUT_TEXT',
    value: 'Someone else',
  });

  expectWebhookError(
    () => parseWebhook(JSON.stringify(duplicateKeyPayload)),
    'duplicate_field'
  );
});

test('rejects selection IDs absent from category options', () => {
  const unknownOptionPayload = makePayload();
  const categories = unknownOptionPayload.data.fields.find(
    (field) => field.key === 'question-categories'
  );
  assert(categories);
  categories.value = ['missing-option-id'];

  expectWebhookError(
    () => parseWebhook(JSON.stringify(unknownOptionPayload)),
    'invalid_field'
  );
});

test('revalidates critical values instead of trusting form configuration', () => {
  const invalidEmailPayload = makePayload();
  const email = invalidEmailPayload.data.fields.find(
    (field) => field.key === 'question-email'
  );
  assert(email);
  email.value = 'ada@example.com';

  expectWebhookError(
    () => parseWebhook(JSON.stringify(invalidEmailPayload)),
    'invalid_field'
  );

  const tooLongPayload = makePayload();
  const idea = tooLongPayload.data.fields.find(
    (field) => field.key === 'question-wtf-idea'
  );
  assert(idea);
  idea.value = 'x'.repeat(601);

  expectWebhookError(
    () => parseWebhook(JSON.stringify(tooLongPayload)),
    'invalid_field'
  );
});

test('validates the configured immutable field-key map', () => {
  assert.deepEqual(parseTallyFieldKeys(JSON.stringify(FIELD_KEYS)), FIELD_KEYS);
  assert.equal(parseTallyFieldKeys(undefined), null);
  assert.equal(parseTallyFieldKeys('{'), null);
  assert.equal(
    parseTallyFieldKeys(
      JSON.stringify({ ...FIELD_KEYS, email: FIELD_KEYS.name })
    ),
    null,
    'each question must have its own immutable key'
  );
});

test('requires the official Tally submission timestamp', () => {
  const payload = makePayload();
  payload.data.createdAt = 'not-a-timestamp';

  expectWebhookError(
    () => parseWebhook(JSON.stringify(payload)),
    'invalid_payload'
  );
});

test('rejects an oversized webhook before signature verification', async () => {
  const environment = {
    DATABASE_URL: process.env.DATABASE_URL,
    TALLY_WEBHOOK_SECRET: process.env.TALLY_WEBHOOK_SECRET,
    TALLY_FORM_ID: process.env.TALLY_FORM_ID,
    TALLY_FIELD_KEYS: process.env.TALLY_FIELD_KEYS,
  };

  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/test';
  process.env.TALLY_WEBHOOK_SECRET = 'test-secret';
  process.env.TALLY_FORM_ID = FORM_ID;
  process.env.TALLY_FIELD_KEYS = JSON.stringify(FIELD_KEYS);

  try {
    const { POST } = await import('../app/api/tally/webhook/route');
    const response = await POST(
      new Request('http://localhost/api/tally/webhook', {
        method: 'POST',
        body: new Uint8Array(1_000_001),
      })
    );

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: 'Webhook payload is too large',
    });
  } finally {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
