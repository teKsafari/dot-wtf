import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const FIELD_NAMES = {
  name: 'Name',
  email: 'Email',
  whatsapp: 'WhatsApp',
  categories: "What's your thing?",
  otherCategory: 'Other category',
  wtfIdea: 'Your WTF idea',
  currentProject: 'Current project',
  youtubeLink: 'A video of something that interests you',
} as const;

const tallyKeySchema = z.string().trim().min(1);

const tallyFieldKeysSchema = z
  .object({
    name: tallyKeySchema,
    email: tallyKeySchema,
    whatsapp: tallyKeySchema,
    categories: tallyKeySchema,
    otherCategory: tallyKeySchema,
    wtfIdea: tallyKeySchema,
    currentProject: tallyKeySchema,
    youtubeLink: tallyKeySchema,
    otherCategoryOptionId: tallyKeySchema,
  })
  .strict()
  .refine(
    ({ otherCategoryOptionId: _otherCategoryOptionId, ...fieldKeys }) =>
      new Set(Object.values(fieldKeys)).size === 8,
    'Tally question keys must be unique'
  );

const tallyOptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .passthrough();

const tallyFieldSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.string().min(1),
    value: z.unknown(),
    options: z.array(tallyOptionSchema).optional(),
  })
  .passthrough();

const tallyWebhookSchema = z
  .object({
    eventId: z.string().min(1),
    // Tally's dashboard test/retry deliveries omit this property.
    eventType: z.string().min(1).optional(),
    data: z
      .object({
        submissionId: z.string().min(1),
        formId: z.string().min(1),
        createdAt: z.string().datetime({ offset: true }),
        fields: z.array(tallyFieldSchema),
      })
      .passthrough(),
  })
  .passthrough();

type TallyField = z.infer<typeof tallyFieldSchema>;
export type TallyFieldKeys = z.infer<typeof tallyFieldKeysSchema>;

export type TallyWebhookErrorCode =
  | 'invalid_json'
  | 'invalid_payload'
  | 'unexpected_event'
  | 'unexpected_form'
  | 'missing_field'
  | 'duplicate_field'
  | 'invalid_field';

export class TallyWebhookError extends Error {
  constructor(
    public readonly code: TallyWebhookErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TallyWebhookError';
  }
}

export interface ParsedTallySubmission {
  eventId: string;
  tallySubmissionId: string;
  formId: string;
  submittedAt: string;
  name: string;
  email: string;
  whatsapp: string;
  categories: string[];
  otherCategory: string | null;
  wtfIdea: string;
  currentProject: string;
  youtubeLink: string;
}

export function parseTallyFieldKeys(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const decodedValue: unknown = JSON.parse(value);
    const parsedValue = tallyFieldKeysSchema.safeParse(decodedValue);
    return parsedValue.success ? parsedValue.data : null;
  } catch {
    return null;
  }
}

type RawBody = string | Uint8Array;

function rawBodyBuffer(rawBody: RawBody) {
  return typeof rawBody === 'string'
    ? Buffer.from(rawBody, 'utf8')
    : Buffer.from(rawBody);
}

/**
 * Tally signs the exact request body with HMAC-SHA256 and base64 encodes the
 * digest. Compare decoded digests so malformed or differently sized values
 * fail before timingSafeEqual is called.
 */
export function verifyTallySignature(
  rawBody: RawBody,
  signature: string | null,
  secret: string
) {
  if (!signature || !secret) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(rawBodyBuffer(rawBody))
    .digest();
  const encodedSignature = signature.trim();

  // A SHA-256 digest has one canonical 44-character base64 representation.
  // Node's base64 decoder otherwise ignores some invalid characters, which
  // could make a malformed header compare equal to a valid signature.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedSignature)) {
    return false;
  }

  const provided = Buffer.from(encodedSignature, 'base64');

  return (
    provided.length === expected.length &&
    provided.toString('base64') === encodedSignature &&
    timingSafeEqual(provided, expected)
  );
}

function findField(
  fields: TallyField[],
  key: string,
  fieldName: string,
  expectedType: TallyField['type'],
  required?: true
): TallyField;
function findField(
  fields: TallyField[],
  key: string,
  fieldName: string,
  expectedType: TallyField['type'],
  required: false
): TallyField | undefined;
function findField(
  fields: TallyField[],
  key: string,
  fieldName: string,
  expectedType: TallyField['type'],
  required = true
) {
  const matchingFields = fields.filter((field) => field.key === key);

  if (matchingFields.length === 0) {
    if (!required) {
      return undefined;
    }

    throw new TallyWebhookError(
      'missing_field',
      `Missing Tally field: ${fieldName}`
    );
  }

  if (matchingFields.length > 1) {
    throw new TallyWebhookError(
      'duplicate_field',
      `Tally payload contains multiple values for: ${fieldName}`
    );
  }

  const [field] = matchingFields;
  if (field.type !== expectedType) {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${fieldName} has unexpected type ${field.type}`
    );
  }

  return field;
}

function requiredText(field: TallyField, maxLength?: number) {
  if (typeof field.value !== 'string') {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} must contain text`
    );
  }

  const value = field.value.trim();
  if (!value || (maxLength !== undefined && value.length > maxLength)) {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} contains an invalid value`
    );
  }

  return value;
}

function optionalText(field: TallyField | undefined) {
  if (!field || field.value === null || field.value === '') {
    return null;
  }

  return requiredText(field);
}

function parseEmail(field: TallyField) {
  const parsedEmail = z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLocaleLowerCase('en-US'))
    .refine((value) => value.endsWith('@case.edu'))
    .safeParse(field.value);

  if (!parsedEmail.success) {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} must contain a @case.edu email address`
    );
  }

  return parsedEmail.data;
}

function parsePhone(field: TallyField) {
  const value = requiredText(field);
  const numberOfDigits = value.replace(/\D/g, '').length;

  if (numberOfDigits < 8 || numberOfDigits > 15) {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} must contain a valid phone number`
    );
  }

  return value;
}

function parseHttpUrl(field: TallyField) {
  const value = requiredText(field);
  const normalizedValue = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  try {
    const url = new URL(normalizedValue);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname
    ) {
      throw new Error('Unsupported URL');
    }
  } catch {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} must contain a valid URL`
    );
  }

  return normalizedValue;
}

function parseSelectedOptions(field: TallyField) {
  const selectedIds = z.array(z.string().min(1)).safeParse(field.value);
  const parsedOptions = z.array(tallyOptionSchema).safeParse(field.options);

  if (
    !selectedIds.success ||
    selectedIds.data.length === 0 ||
    new Set(selectedIds.data).size !== selectedIds.data.length ||
    !parsedOptions.success
  ) {
    throw new TallyWebhookError(
      'invalid_field',
      `Tally field ${field.label} must contain selected options`
    );
  }

  const optionTextById = new Map<string, string>();
  for (const option of parsedOptions.data) {
    const optionText = option.text.trim();
    if (optionTextById.has(option.id)) {
      throw new TallyWebhookError(
        'invalid_field',
        `Tally field ${field.label} contains duplicate option IDs`
      );
    }
    if (!optionText) {
      throw new TallyWebhookError(
        'invalid_field',
        `Tally field ${field.label} contains a blank option`
      );
    }
    optionTextById.set(option.id, optionText);
  }

  return selectedIds.data.map((selectedId) => {
    const optionText = optionTextById.get(selectedId);
    if (!optionText) {
      throw new TallyWebhookError(
        'invalid_field',
        `Tally field ${field.label} references an unknown option`
      );
    }
    return { id: selectedId, text: optionText };
  });
}

export function parseTallyWebhook(
  rawBody: RawBody,
  expectedFormId: string,
  fieldKeys: TallyFieldKeys
): ParsedTallySubmission {
  let decodedBody: unknown;
  try {
    decodedBody = JSON.parse(rawBodyBuffer(rawBody).toString('utf8'));
  } catch {
    throw new TallyWebhookError('invalid_json', 'Invalid webhook JSON');
  }

  const parsedPayload = tallyWebhookSchema.safeParse(decodedBody);
  if (!parsedPayload.success) {
    throw new TallyWebhookError(
      'invalid_payload',
      'Webhook does not match the Tally payload schema'
    );
  }

  const payload = parsedPayload.data;
  if (
    payload.eventType !== undefined &&
    payload.eventType !== 'FORM_RESPONSE'
  ) {
    throw new TallyWebhookError(
      'unexpected_event',
      `Unsupported Tally event type: ${payload.eventType}`
    );
  }

  if (payload.data.formId !== expectedFormId) {
    throw new TallyWebhookError(
      'unexpected_form',
      'Webhook came from an unexpected Tally form'
    );
  }

  const nameField = findField(
    payload.data.fields,
    fieldKeys.name,
    FIELD_NAMES.name,
    'INPUT_TEXT'
  );
  const emailField = findField(
    payload.data.fields,
    fieldKeys.email,
    FIELD_NAMES.email,
    'INPUT_EMAIL'
  );
  const whatsappField = findField(
    payload.data.fields,
    fieldKeys.whatsapp,
    FIELD_NAMES.whatsapp,
    'INPUT_PHONE_NUMBER'
  );
  const categoriesField = findField(
    payload.data.fields,
    fieldKeys.categories,
    FIELD_NAMES.categories,
    'CHECKBOXES'
  );
  const otherCategoryField = findField(
    payload.data.fields,
    fieldKeys.otherCategory,
    FIELD_NAMES.otherCategory,
    'INPUT_TEXT',
    false
  );
  const wtfIdeaField = findField(
    payload.data.fields,
    fieldKeys.wtfIdea,
    FIELD_NAMES.wtfIdea,
    'TEXTAREA'
  );
  const currentProjectField = findField(
    payload.data.fields,
    fieldKeys.currentProject,
    FIELD_NAMES.currentProject,
    'TEXTAREA'
  );
  const youtubeLinkField = findField(
    payload.data.fields,
    fieldKeys.youtubeLink,
    FIELD_NAMES.youtubeLink,
    'INPUT_LINK'
  );

  const selectedCategories = parseSelectedOptions(categoriesField);
  const selectedOtherCategory = selectedCategories.some(
    (category) => category.id === fieldKeys.otherCategoryOptionId
  );

  if (
    selectedCategories.some(
      (category) =>
        category.text === 'Other' &&
        category.id !== fieldKeys.otherCategoryOptionId
    )
  ) {
    throw new TallyWebhookError(
      'invalid_field',
      'The configured Other category option does not match the Tally form'
    );
  }

  const categories = selectedCategories.map((category) =>
    category.id === fieldKeys.otherCategoryOptionId ? 'Other' : category.text
  );
  const otherCategory = selectedOtherCategory
    ? optionalText(otherCategoryField)
    : null;

  if (selectedOtherCategory && !otherCategory) {
    throw new TallyWebhookError(
      'missing_field',
      `Missing Tally field: ${FIELD_NAMES.otherCategory}`
    );
  }

  return {
    eventId: payload.eventId,
    tallySubmissionId: payload.data.submissionId,
    formId: payload.data.formId,
    submittedAt: payload.data.createdAt,
    name: requiredText(nameField),
    email: parseEmail(emailField),
    whatsapp: parsePhone(whatsappField),
    categories,
    otherCategory,
    wtfIdea: requiredText(wtfIdeaField, 600),
    currentProject: requiredText(currentProjectField, 600),
    youtubeLink: parseHttpUrl(youtubeLinkField),
  };
}
