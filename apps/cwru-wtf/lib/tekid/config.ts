import 'server-only';

import type { LogtoNextConfig } from '@logto/next';
import { env } from '@/env';
import type { ApplicationEnv } from '@/lib/env-schema';

export const tekidCallbackPath = '/api/tekid/callback';
export { tekidProfilePath, tekidDashboardPath } from './redirects';

type TekidEnvironment = Pick<ApplicationEnv,
  'LOGTO_APP_ID' | 'LOGTO_APP_SECRET' | 'LOGTO_BASE_URL' | 'LOGTO_COOKIE_SECRET'
>;

export function getTekidConfig(
  environment: TekidEnvironment = env
): LogtoNextConfig {
  return {
    endpoint: 'https://id.teksafari.org/',
    appId: environment.LOGTO_APP_ID,
    appSecret: environment.LOGTO_APP_SECRET,
    baseUrl: environment.LOGTO_BASE_URL,
    cookieSecret: environment.LOGTO_COOKIE_SECRET,
    cookieSecure: environment.LOGTO_BASE_URL.startsWith('https://'),
    // The SDK adds openid, profile, and offline_access; the session also requires email.
    scopes: ['email'],
  };
}
