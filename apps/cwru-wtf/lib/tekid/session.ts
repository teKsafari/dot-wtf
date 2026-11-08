import 'server-only';

import { createHash } from 'node:crypto';
import { CompactEncrypt, compactDecrypt } from 'jose';
import { cookies } from 'next/headers';

import type { TekidConfig } from './config';
import { getTekidReturnPath } from './redirects';
import type { AuthSession } from './types';

const sessionCookieName = 'tekid_session';
const flowCookieName = 'tekid_flow';
// The sign-in handshake is short-lived; the session lasts a working fortnight.
const flowLifetimeSeconds = 10 * 60;
const sessionLifetimeSeconds = 14 * 24 * 60 * 60;

export type TekidSession = {
  claims: Partial<Record<keyof AuthSession, unknown>>;
  idToken?: string;
  expiresAt: number;
};

export type TekidSignInFlow = {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
};

// The cookie secret is a shared string of at least 32 characters; derive a fixed-length key.
function encryptionKey(cookieSecret: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(cookieSecret, 'utf8').digest());
}

async function seal(value: unknown, cookieSecret: string): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(value)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(encryptionKey(cookieSecret));
}

// A cookie that fails to decrypt is a cookie from another secret: treat it as absent.
async function unseal(token: string, cookieSecret: string): Promise<unknown> {
  try {
    const { plaintext } = await compactDecrypt(token, encryptionKey(cookieSecret));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

function cookieOptions(config: TekidConfig, maxAge: number) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export async function writeTekidSignInFlow(config: TekidConfig, flow: TekidSignInFlow): Promise<void> {
  const store = await cookies();
  store.set(flowCookieName, await seal(flow, config.cookieSecret), cookieOptions(config, flowLifetimeSeconds));
}

export async function readTekidSignInFlow(config: TekidConfig): Promise<TekidSignInFlow | null> {
  const token = (await cookies()).get(flowCookieName)?.value;
  if (!token) return null;

  const value = await unseal(token, config.cookieSecret);
  if (!value || typeof value !== 'object') return null;

  const { codeVerifier, state, nonce, returnTo } = value as Record<string, unknown>;
  if (typeof codeVerifier !== 'string' || typeof state !== 'string' || typeof nonce !== 'string') {
    return null;
  }

  return { codeVerifier, state, nonce, returnTo: getTekidReturnPath(returnTo) };
}

export async function clearTekidSignInFlow(): Promise<void> {
  (await cookies()).delete(flowCookieName);
}

export async function writeTekidSession(
  config: TekidConfig,
  session: Omit<TekidSession, 'expiresAt'>
): Promise<void> {
  const store = await cookies();
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
  const value = await seal({ ...session, expiresAt }, config.cookieSecret);
  store.set(sessionCookieName, value, cookieOptions(config, sessionLifetimeSeconds));
}

export async function readTekidSession(config: TekidConfig): Promise<TekidSession | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  const value = await unseal(token, config.cookieSecret);
  if (!value || typeof value !== 'object') return null;

  const { claims, idToken, expiresAt } = value as Record<string, unknown>;
  if (typeof expiresAt !== 'number' || expiresAt <= Date.now() / 1000) return null;
  if (!claims || typeof claims !== 'object') return null;

  return {
    claims: claims as TekidSession['claims'],
    idToken: typeof idToken === 'string' ? idToken : undefined,
    expiresAt,
  };
}

export async function clearTekidSession(): Promise<void> {
  (await cookies()).delete(sessionCookieName);
}
