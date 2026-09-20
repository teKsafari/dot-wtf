import { testEnvironment } from './test-env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createApplicationEnv } from '../lib/env-schema';

test('validates required variables and preserves credential values', () => {
  const environment = createApplicationEnv({
    ...testEnvironment,
    LOGTO_APP_SECRET: ' credential-with-intentional-spaces ',
  });

  assert.equal(environment.DATABASE_URL, testEnvironment.DATABASE_URL);
  assert.equal(environment.AUTH_SECRET, testEnvironment.AUTH_SECRET);
  assert.equal(environment.LOGTO_APP_ID, testEnvironment.LOGTO_APP_ID);
  assert.equal(environment.LOGTO_APP_SECRET, ' credential-with-intentional-spaces ');
  assert.equal(environment.LOGTO_COOKIE_SECRET, testEnvironment.LOGTO_COOKIE_SECRET);
});

test('rejects every missing, empty, or whitespace-only required value', () => {
  for (const key of [
    'DATABASE_URL',
    'AUTH_SECRET',
    'LOGTO_APP_ID',
    'LOGTO_APP_SECRET',
    'LOGTO_BASE_URL',
    'LOGTO_COOKIE_SECRET',
  ]) {
    for (const value of [undefined, '', ' \n\t ']) {
      assert.throws(
        () => createApplicationEnv({ ...testEnvironment, [key]: value }),
        new RegExp(`Invalid environment variables:.*\\b${key}\\b`)
      );
    }
  }
});

test('requires a database URL and a cookie secret of at least 32 characters', () => {
  assert.throws(
    () => createApplicationEnv({ ...testEnvironment, DATABASE_URL: 'not-a-url' }),
    /DATABASE_URL/
  );
  assert.throws(
    () => createApplicationEnv({ ...testEnvironment, LOGTO_COOKIE_SECRET: 'x'.repeat(31) }),
    /LOGTO_COOKIE_SECRET/
  );
  assert.equal(
    createApplicationEnv({ ...testEnvironment, LOGTO_COOKIE_SECRET: 'x'.repeat(32) })
      .LOGTO_COOKIE_SECRET,
    'x'.repeat(32)
  );
});

test('accepts an origin with an optional trailing slash and normalizes it', () => {
  for (const baseUrl of ['https://cwru.wtf', 'https://cwru.wtf/']) {
    assert.equal(
      createApplicationEnv({ ...testEnvironment, LOGTO_BASE_URL: baseUrl }).LOGTO_BASE_URL,
      'https://cwru.wtf'
    );
  }
  assert.equal(
    createApplicationEnv(testEnvironment).LOGTO_BASE_URL,
    'http://dot-wtf.localhost:1355'
  );
});

test('rejects origins that can change callbacks or include credentials', () => {
  for (const baseUrl of [
    '/relative',
    'not-a-url',
    'javascript:alert(1)',
    'mailto:member@example.org',
    'ftp://cwru.wtf',
    'https://user:password@cwru.wtf',
    'https://cwru.wtf/profile',
    'https://cwru.wtf?next=https://example.org',
    'https://cwru.wtf#fragment',
    'https://cwru.wtf/../',
    ' https://cwru.wtf',
    'https:\\cwru.wtf',
  ]) {
    assert.throws(
      () => createApplicationEnv({ ...testEnvironment, LOGTO_BASE_URL: baseUrl }),
      /LOGTO_BASE_URL/
    );
  }
});

test('production requires HTTPS while development can use the Portless origin', () => {
  assert.throws(
    () => createApplicationEnv({ ...testEnvironment, NODE_ENV: 'production' }),
    /LOGTO_BASE_URL/
  );
  assert.equal(
    createApplicationEnv({
      ...testEnvironment,
      NODE_ENV: 'production',
      LOGTO_BASE_URL: 'https://cwru.wtf',
    }).LOGTO_BASE_URL,
    'https://cwru.wtf'
  );
  assert.equal(
    createApplicationEnv({ ...testEnvironment, NODE_ENV: 'development' }).LOGTO_BASE_URL,
    testEnvironment.LOGTO_BASE_URL
  );
});

test('defaults NODE_ENV to development and rejects unknown modes', () => {
  for (const mode of [undefined, '']) {
    assert.equal(
      createApplicationEnv({ ...testEnvironment, NODE_ENV: mode }).NODE_ENV,
      'development'
    );
  }
  assert.throws(
    () => createApplicationEnv({ ...testEnvironment, NODE_ENV: 'staging' }),
    /NODE_ENV/
  );
});

test('keeps Tally settings optional and treats empty strings as absent', () => {
  const absent = createApplicationEnv({
    ...testEnvironment,
    TALLY_WEBHOOK_SECRET: '',
    TALLY_FORM_ID: '',
    TALLY_FIELD_KEYS: '',
  });
  assert.equal(absent.TALLY_WEBHOOK_SECRET, undefined);
  assert.equal(absent.TALLY_FORM_ID, undefined);
  assert.equal(absent.TALLY_FIELD_KEYS, undefined);

  const configured = createApplicationEnv({
    ...testEnvironment,
    TALLY_WEBHOOK_SECRET: 'test-webhook-secret',
    TALLY_FORM_ID: 'test-form',
    TALLY_FIELD_KEYS: '{"name":"question-name"}',
  });
  assert.equal(configured.TALLY_WEBHOOK_SECRET, 'test-webhook-secret');
  assert.equal(configured.TALLY_FORM_ID, 'test-form');
  assert.equal(configured.TALLY_FIELD_KEYS, '{"name":"question-name"}');
});

test('validation errors report variable names without exposing their values', () => {
  assert.throws(
    () => createApplicationEnv({
      ...testEnvironment,
      DATABASE_URL: 'private-database-value',
      LOGTO_COOKIE_SECRET: 'private-cookie-value',
      LOGTO_BASE_URL: 'https://private-user:private-password@cwru.wtf',
    }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /^Invalid environment variables: /);
      for (const key of ['DATABASE_URL', 'LOGTO_COOKIE_SECRET', 'LOGTO_BASE_URL']) {
        assert.match(error.message, new RegExp(key));
      }
      assert.doesNotMatch(error.message, /private-|https:\/\//);
      return true;
    }
  );
});

test('importing the application environment fails before any request with missing configuration', () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...testEnvironment };
  delete environment.LOGTO_APP_ID;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', "import './env.ts';"],
    {
      cwd: new URL('../', import.meta.url),
      env: environment,
      encoding: 'utf8',
    }
  );

  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid environment variables: LOGTO_APP_ID/);
  assert.doesNotMatch(result.stderr, new RegExp(testEnvironment.LOGTO_APP_SECRET));
});
