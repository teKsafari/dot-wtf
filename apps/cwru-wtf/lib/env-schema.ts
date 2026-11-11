import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const nonblank = z.string().refine((value) => value.trim().length > 0);
const defaultTekidIssuer = 'https://auth.mules.wtf';
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
      // The tekID OpenID Connect issuer. Discovery, authorization, token, userinfo and
      // end-session endpoints are read from its discovery document, never hard-coded.
      TEKID_ISSUER: origin.default(defaultTekidIssuer),
      // tekID admin API key. Approval creates the applicant's tekID account with it.
      // Optional so a build or a read-only deployment starts without it; approval
      // reports that review is unavailable rather than half-approving somebody.
      TEKID_API_KEY: nonblank.optional(),
      // Approved members join this tekID group, so another club service can
      // authorize on the groups claim instead of asking this database.
      TEKID_MEMBER_GROUP: nonblank.default('members'),
      // Lifetime of the one-time sign-in link shown to the reviewer after approval.
      TEKID_LINK_TTL: z.string().regex(/^[1-9][0-9]{0,3}[smhd]$/).default('12h'),
      // Where application photos are written. A bind mount in the container; a
      // local directory in development. Swapping to object storage replaces the
      // driver in lib/uploads.ts, not this path's callers.
      UPLOADS_DIR: nonblank.default('./.uploads'),
      UPLOADS_MAX_BYTES: z.coerce.number().int().min(1).max(50_000_000).default(5_000_000),
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
