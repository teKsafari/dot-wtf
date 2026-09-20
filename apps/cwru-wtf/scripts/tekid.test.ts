import assert from 'node:assert/strict';
import test from 'node:test';

import { getTekidConfig } from '../lib/tekid/config';
import { getTekidProfileFromClaims } from '../lib/tekid/profile';

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LOGTO_APP_ID: 'test-app',
  LOGTO_APP_SECRET: 'test-app-secret',
  LOGTO_BASE_URL: 'http://dot-wtf.localhost:1355',
  LOGTO_COOKIE_SECRET: 'test-cookie-secret-at-least-32-characters',
};

test('config keeps the public origin and uses only default profile scopes', () => {
  const local = getTekidConfig(environment);
  assert.equal(local.baseUrl, 'http://dot-wtf.localhost:1355');
  assert.equal(local.endpoint, 'https://id.teksafari.org/');
  assert.equal(local.cookieSecure, false);
  assert.deepEqual(local.scopes, []);

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

test('profile exposes only the authenticated display name and photo', () => {
  const claims = {
    sub: 'private-subject',
    name: '  Ada Lovelace  ',
    username: 'ada',
    picture: 'https://images.example.org/ada.png',
    email: 'private@example.org',
    roles: ['Admin'],
    iss: 'https://id.teksafari.org/oidc',
    aud: 'test-app',
    exp: 1234567890,
    accessToken: 'private-access-token',
  };

  assert.deepEqual(getTekidProfileFromClaims(true, claims), {
    name: 'Ada Lovelace',
    picture: 'https://images.example.org/ada.png',
  });
  assert.equal(getTekidProfileFromClaims(false, claims), null);
  assert.equal(getTekidProfileFromClaims(true, null), null);
  assert.equal(getTekidProfileFromClaims(true, undefined), null);
});

test('profile handles missing, blank, nullable, or malformed display values', () => {
  assert.deepEqual(
    getTekidProfileFromClaims(true, { name: null, username: '  ada  ', picture: null }),
    { name: 'ada', picture: null }
  );
  assert.deepEqual(getTekidProfileFromClaims(true, {}), {
    name: 'Member',
    picture: null,
  });
  assert.deepEqual(
    getTekidProfileFromClaims(true, { name: ' ', username: 42, picture: {} }),
    { name: 'Member', picture: null }
  );
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
    assert.equal(getTekidProfileFromClaims(true, { picture })?.picture, null);
  }
});
