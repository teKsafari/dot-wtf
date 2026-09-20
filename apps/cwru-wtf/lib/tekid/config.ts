import 'server-only';

import type { LogtoNextConfig } from '@logto/next';

export const tekidCallbackPath = '/api/tekid/callback';
export const tekidProfilePath = '/test-profile';

function requiredVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];

  if (!value?.trim()) {
    throw new Error(`Missing required tekID environment variable: ${name}`);
  }

  return value;
}

// Read on demand so unrelated pages and build-time imports do not require tekID.
export function getTekidConfig(
  environment: NodeJS.ProcessEnv = process.env
): LogtoNextConfig {
  const appId = requiredVariable(environment, 'LOGTO_APP_ID');
  const appSecret = requiredVariable(environment, 'LOGTO_APP_SECRET');
  const cookieSecret = requiredVariable(environment, 'LOGTO_COOKIE_SECRET');

  if (cookieSecret.length < 32) {
    throw new Error('LOGTO_COOKIE_SECRET must contain at least 32 characters');
  }

  const baseUrl = requiredVariable(environment, 'LOGTO_BASE_URL');
  let publicUrl: URL;

  try {
    publicUrl = new URL(baseUrl);
  } catch {
    throw new Error('LOGTO_BASE_URL must be an absolute HTTP(S) origin');
  }

  if (
    !['http:', 'https:'].includes(publicUrl.protocol) ||
    (baseUrl !== publicUrl.origin && baseUrl !== `${publicUrl.origin}/`)
  ) {
    throw new Error(
      'LOGTO_BASE_URL must be an HTTP(S) origin without a path, credentials, query, or fragment'
    );
  }

  if (environment.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') {
    throw new Error('LOGTO_BASE_URL must use HTTPS in production');
  }

  return {
    endpoint: 'https://id.teksafari.org/',
    appId,
    appSecret,
    baseUrl: publicUrl.origin,
    cookieSecret,
    cookieSecure: publicUrl.protocol === 'https:',
    // The SDK already requests openid, profile, and offline_access.
    scopes: [],
  };
}
