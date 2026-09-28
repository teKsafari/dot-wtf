import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const nonblank = z.string().refine((value) => value.trim().length > 0);
const previewHostname = z.string().max(253).regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
).refine((value) => !/\s/.test(value));

export function createApplicationEnv(runtimeEnvironment: Record<string, string | undefined>) {
  // Copy before deriving defaults or letting empty-string normalization mutate it.
  const runtimeEnv = { ...runtimeEnvironment };
  if (runtimeEnv.VERCEL_ENV === 'preview' && !runtimeEnv.LOGTO_BASE_URL) {
    const hostname = previewHostname.safeParse(runtimeEnv.VERCEL_BRANCH_URL);
    if (!hostname.success) {
      throw new Error('Invalid environment variables: VERCEL_BRANCH_URL');
    }
    // Vercel's stable branch alias is trusted deployment configuration, not a request header.
    runtimeEnv.LOGTO_BASE_URL = `https://${hostname.data}`;
  }

  const origin = z.string().url().superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return; // The URL schema reports this error.
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (value !== url.origin && value !== `${url.origin}/`)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be an HTTP(S) origin without a path, credentials, query, or fragment',
      });
    }

    if (runtimeEnvironment.NODE_ENV === 'production' && url.protocol !== 'https:') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must use HTTPS in production',
      });
    }
  }).transform((value) => new URL(value).origin);

  return createEnv({
    server: {
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DATABASE_URL: z.string().url(),
      LOGTO_APP_ID: nonblank,
      LOGTO_APP_SECRET: nonblank,
      LOGTO_BASE_URL: origin,
      LOGTO_COOKIE_SECRET: z.string().min(32).refine((value) => value.trim().length > 0),
      TALLY_FORM_ID: nonblank.optional(),
      TALLY_WEBHOOK_SECRET: nonblank.optional(),
      TALLY_FIELD_KEYS: z.string().optional(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    onValidationError(issues) {
      const names = issues.map((issue) => {
        const segment = issue.path?.[0];
        return String(typeof segment === 'object' ? segment.key : segment ?? 'environment');
      });
      throw new Error(`Invalid environment variables: ${[...new Set(names)].join(', ')}`);
    },
  });
}

export type ApplicationEnv = ReturnType<typeof createApplicationEnv>;
