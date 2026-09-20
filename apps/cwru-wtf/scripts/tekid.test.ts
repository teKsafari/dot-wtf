import assert from 'node:assert/strict';
import test from 'node:test';

import { getTekidConfig } from '../lib/tekid/config';
import { getTekidAuthContextFromClaims, TekidProfileContractError } from '../lib/tekid/profile';
import type { AuthContextType } from '../lib/tekid/types';

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LOGTO_APP_ID: 'test-app',
  LOGTO_APP_SECRET: 'test-app-secret',
  LOGTO_BASE_URL: 'http://dot-wtf.localhost:1355',
  LOGTO_COOKIE_SECRET: 'test-cookie-secret-at-least-32-characters',
};

test('config keeps the public origin and requests email for the session contract', () => {
  const local = getTekidConfig(environment);
  assert.equal(local.baseUrl, 'http://dot-wtf.localhost:1355');
  assert.equal(local.endpoint, 'https://id.teksafari.org/');
  assert.equal(local.cookieSecure, false);
  assert.deepEqual(local.scopes, ['email']);

  const production = getTekidConfig({
    ...environment,
    NODE_ENV: 'production',
    LOGTO_BASE_URL: 'https://cwru.wtf/',
  });
  assert.equal(production.baseUrl, 'https://cwru.wtf');
  assert.equal(production.cookieSecure, true);
});

test('config fails clearly for absent credentials or an undersized cookie key', () => {
  for (const key of [
    'LOGTO_APP_ID',
    'LOGTO_APP_SECRET',
    'LOGTO_BASE_URL',
    'LOGTO_COOKIE_SECRET',
  ]) {
    assert.throws(
      () => getTekidConfig({ ...environment, [key]: undefined }),
      new RegExp(`Missing required tekID environment variable: ${key}`)
    );
  }

  assert.throws(
    () => getTekidConfig({ ...environment, LOGTO_COOKIE_SECRET: 'x'.repeat(31) }),
    /LOGTO_COOKIE_SECRET must contain at least 32 characters/
  );
});

test('config rejects origins that can change the intended callback or expose secrets', () => {
  for (const baseUrl of [
    '/relative',
    'javascript:alert(1)',
    'https://user:password@cwru.wtf',
    'https://cwru.wtf/test-profile',
    'https://cwru.wtf?next=https://example.org',
    'https://cwru.wtf#fragment',
    'https://cwru.wtf/../',
    ' https://cwru.wtf',
    'https:\\cwru.wtf',
  ]) {
    assert.throws(
      () => getTekidConfig({ ...environment, LOGTO_BASE_URL: baseUrl }),
      /LOGTO_BASE_URL/
    );
  }

  assert.throws(
    () => getTekidConfig({ ...environment, NODE_ENV: 'production' }),
    /LOGTO_BASE_URL must use HTTPS in production/
  );
});

const completeClaims = {
  sub: 'member-subject',
  name: 'Ada Lovelace',
  username: 'ada',
  email: 'ada@example.org',
  email_verified: true,
  picture: 'https://images.example.org/ada.png',
};

test('authenticated context projects only the application contract fields', () => {
  const claims = {
    ...completeClaims,
    roles: ['Admin'],
    iss: 'https://id.teksafari.org/oidc',
    aud: 'test-app',
    exp: 1234567890,
    accessToken: 'private-access-token',
    custom_data: { internal: true },
  };

  assert.deepEqual(getTekidAuthContextFromClaims(true, claims), {
    isAuthenticated: true,
    claims: completeClaims,
  });
});

test('only a signed-out session produces the signed-out context', () => {
  for (const claims of [completeClaims, null, undefined, {}]) {
    assert.deepEqual(getTekidAuthContextFromClaims(false, claims), {
      isAuthenticated: false,
      claims: null,
    });
  }

  for (const claims of [null, undefined]) {
    assert.throws(
      () => getTekidAuthContextFromClaims(true, claims),
      (error) => error instanceof TekidProfileContractError && error.field === 'claims'
    );
  }
});

test('every required text claim must be a nonblank string', () => {
  for (const field of ['sub', 'name', 'username', 'email'] as const) {
    for (const value of [undefined, null, '', '  ', 42, false, {}, []]) {
      assert.throws(
        () => getTekidAuthContextFromClaims(true, { ...completeClaims, [field]: value }),
        (error) => error instanceof TekidProfileContractError && error.field === field
      );
    }
  }
});

test('email verification is a required boolean and false remains valid', () => {
  const context = getTekidAuthContextFromClaims(true, {
    ...completeClaims,
    email_verified: false,
  });
  assert.equal(context.isAuthenticated, true);
  assert.equal(context.claims?.email_verified, false);

  for (const value of [undefined, null, '', 'true', 'false', 0, 1]) {
    assert.throws(
      () => getTekidAuthContextFromClaims(true, { ...completeClaims, email_verified: value }),
      (error) => error instanceof TekidProfileContractError && error.field === 'email_verified'
    );
  }
});

// tsc checks that the discriminant alone makes all five fields non-nullable.
function consumeAuthContext({ isAuthenticated, claims }: AuthContextType) {
  if (isAuthenticated) {
    const fields: [string, string, string, string, boolean] = [
      claims.sub, claims.name, claims.username, claims.email, claims.email_verified,
    ];
    return fields;
  }
  const signedOutClaims: null = claims;
  return signedOutClaims;
}

test('consumers narrow the complete contract with isAuthenticated alone', () => {
  assert.deepEqual(consumeAuthContext(getTekidAuthContextFromClaims(true, completeClaims)), [
    'member-subject', 'Ada Lovelace', 'ada', 'ada@example.org', true,
  ]);
  assert.equal(consumeAuthContext(getTekidAuthContextFromClaims(false, null)), null);
});

test('missing or malformed optional photos become null', () => {
  for (const picture of [undefined, null, '', ' ', {}, 42]) {
    const context = getTekidAuthContextFromClaims(true, { ...completeClaims, picture });
    assert.equal(context.claims?.picture, null);
  }
});

test('profile rejects non-HTTPS, relative, malformed, or credential-bearing photos', () => {
  for (const picture of [
    'http://images.example.org/ada.png',
    '//images.example.org/ada.png',
    '/ada.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg></svg>',
    'https://user:password@images.example.org/ada.png',
    'not a URL',
  ]) {
    const context = getTekidAuthContextFromClaims(true, { ...completeClaims, picture });
    assert.equal(context.claims?.picture, null);
  }
});

test('contract errors identify the field without exposing profile values', () => {
  assert.throws(
    () => getTekidAuthContextFromClaims(true, {
      ...completeClaims,
      username: { private: 'private-profile-value' },
    }),
    (error) => error instanceof TekidProfileContractError &&
      error.message.includes('username') && !error.message.includes('private-profile-value')
  );
});
