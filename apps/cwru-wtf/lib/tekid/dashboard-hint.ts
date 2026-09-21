import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/env';
import { getTekidOrganizationConfig } from './management';

export const dashboardHintCookieName = 'tekid-dashboard-hint';
export const dashboardHintMaxAgeSeconds = 12 * 60 * 60;

export interface DashboardHintScope {
  sub: string;
  organizationId: string;
  secret: string;
}

// The cookie carries only the verdict and expiry. The user and organization go
// into the signature instead, so a hint from another account or instance fails
// verification without the cookie ever holding readable identifiers.
function signHint(allowed: boolean, expiresAt: number, scope: DashboardHintScope): string {
  return createHmac('sha256', scope.secret)
    .update(`v1\n${scope.sub}\n${scope.organizationId}\n${allowed ? '1' : '0'}\n${expiresAt}`)
    .digest('base64url');
}

export function encodeDashboardHint(allowed: boolean, expiresAt: number, scope: DashboardHintScope): string {
  return `v1.${allowed ? '1' : '0'}.${expiresAt}.${signHint(allowed, expiresAt, scope)}`;
}

export function decodeDashboardHint(
  value: string | undefined,
  scope: DashboardHintScope,
  now = Date.now()
): boolean | null {
  const match = value?.match(/^v1\.([01])\.(\d{1,15})\.([A-Za-z0-9_-]+)$/);
  if (!match) return null;

  const allowed = match[1] === '1';
  const expiresAt = Number(match[2]);
  if (expiresAt <= now) return null;

  const expected = Buffer.from(signHint(allowed, expiresAt, scope));
  const provided = Buffer.from(match[3]);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  return allowed;
}

function currentScope(sub: string): DashboardHintScope {
  return {
    sub,
    organizationId: getTekidOrganizationConfig().organizationId,
    secret: env.LOGTO_COOKIE_SECRET,
  };
}

export function createDashboardHint(sub: string, allowed: boolean): string {
  return encodeDashboardHint(allowed, Date.now() + dashboardHintMaxAgeSeconds * 1000, currentScope(sub));
}

export function verifyDashboardHint(value: string | undefined, sub: string): boolean | null {
  return decodeDashboardHint(value, currentScope(sub));
}

export function dashboardHintCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.LOGTO_BASE_URL.startsWith('https://'),
    path: '/',
    maxAge: dashboardHintMaxAgeSeconds,
  } as const;
}
