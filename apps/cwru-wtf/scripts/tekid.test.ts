import { testEnvironment } from './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationEnv } from '../lib/env-schema';
import { getTekidConfig } from '../lib/tekid/config';
import { getTekidAuthContextFromClaims, TekidProfileContractError } from '../lib/tekid/profile';
import type { AuthContextType } from '../lib/tekid/types';

test('config keeps the public origin and requests email for the session contract', () => {
  const local = getTekidConfig(createApplicationEnv(testEnvironment));
  assert.equal(local.baseUrl, 'http://dot-wtf.localhost:1355');
  assert.equal(local.endpoint, 'https://id.teksafari.org/');
  assert.equal(local.cookieSecure, false);
  assert.deepEqual(local.scopes, ['email']);

  const production = getTekidConfig(createApplicationEnv({
    ...testEnvironment,
    NODE_ENV: 'production',
    LOGTO_BASE_URL: 'https://cwru.wtf/',
  }));
  assert.equal(production.baseUrl, 'https://cwru.wtf');
  assert.equal(production.cookieSecure, true);
});

test('config defaults to the validated application environment', () => {
  const config = getTekidConfig();
  assert.equal(config.appId, testEnvironment.LOGTO_APP_ID);
  assert.equal(config.appSecret, testEnvironment.LOGTO_APP_SECRET);
  assert.equal(config.cookieSecret, testEnvironment.LOGTO_COOKIE_SECRET);
  assert.equal(config.baseUrl, testEnvironment.LOGTO_BASE_URL);
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
  for (const field of ['sub', 'name', 'email'] as const) {
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

// tsc checks that the discriminant alone makes the required fields non-nullable.
function consumeAuthContext({ isAuthenticated, claims }: AuthContextType) {
  if (isAuthenticated) {
    const fields: [string, string, string, boolean] = [
      claims.sub, claims.name, claims.email, claims.email_verified,
    ];
    // @ts-expect-error Authentication does not guarantee an assigned username.
    const requiredUsername: string = claims.username;
    return fields;
  }
  const signedOutClaims: null = claims;
  return signedOutClaims;
}

test('consumers narrow the complete contract with isAuthenticated alone', () => {
  assert.deepEqual(consumeAuthContext(getTekidAuthContextFromClaims(true, completeClaims)), [
    'member-subject', 'Ada Lovelace', 'ada@example.org', true,
  ]);
  assert.equal(consumeAuthContext(getTekidAuthContextFromClaims(false, null)), null);
});

test('an unassigned or malformed username does not block an authenticated profile', () => {
  const { username: _username, ...withoutUsername } = completeClaims;
  for (const claims of [
    withoutUsername,
    ...[undefined, null, '', ' ', {}, 42, false, []].map((username) => ({
      ...completeClaims, username,
    })),
  ]) {
    const context = getTekidAuthContextFromClaims(true, claims);
    assert.equal(context.isAuthenticated, true);
    if (!context.isAuthenticated) assert.fail('Expected an authenticated profile');
    assert.equal(context.claims.name, 'Ada Lovelace');
    assert.equal(context.claims.username, null);
    assert.deepEqual(consumeAuthContext(context), [
      'member-subject', 'Ada Lovelace', 'ada@example.org', true,
    ]);
  }
});

test('an assigned username is distinct from the required display name', () => {
  const context = getTekidAuthContextFromClaims(true, completeClaims);
  assert.equal(context.claims?.name, 'Ada Lovelace');
  assert.equal(context.claims?.username, 'ada');
  assert.throws(
    () => getTekidAuthContextFromClaims(true, { ...completeClaims, name: undefined }),
    (error) => error instanceof TekidProfileContractError && error.field === 'name'
  );
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
      name: { private: 'private-profile-value' },
    }),
    (error) => error instanceof TekidProfileContractError &&
      error.message.includes('name') && !error.message.includes('private-profile-value')
  );
});
