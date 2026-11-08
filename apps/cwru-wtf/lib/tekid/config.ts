import 'server-only';

import { env } from '@/env';
import type { ApplicationEnv } from '@/lib/env-schema';

export const tekidCallbackPath = '/api/tekid/callback';
export { tekidProfilePath, tekidDashboardPath, tekidMembersPath } from './redirects';

// tekID speaks plain OpenID Connect: discovery at <issuer>/.well-known/openid-configuration,
// authorization code with PKCE, RS256 ID tokens. The provider is Pocket ID.
export type TekidConfig = {
  endpoint: string;
  appId: string;
  appSecret: string;
  baseUrl: string;
  cookieSecret: string;
  cookieSecure: boolean;
  scopes: string[];
};

type TekidEnvironment = Pick<ApplicationEnv,
  'LOGTO_APP_ID' | 'LOGTO_APP_SECRET' | 'LOGTO_BASE_URL' | 'LOGTO_COOKIE_SECRET' | 'TEKID_ISSUER'
>;

export function getTekidConfig(
  environment: TekidEnvironment = env
): TekidConfig {
  return {
    endpoint: environment.TEKID_ISSUER,
    appId: environment.LOGTO_APP_ID,
    appSecret: environment.LOGTO_APP_SECRET,
    baseUrl: environment.LOGTO_BASE_URL,
    cookieSecret: environment.LOGTO_COOKIE_SECRET,
    cookieSecure: environment.LOGTO_BASE_URL.startsWith('https://'),
    // openid is the protocol minimum; the session contract also requires name and email.
    scopes: ['openid', 'profile', 'email'],
  };
}
