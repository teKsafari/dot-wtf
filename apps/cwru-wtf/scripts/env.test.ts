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
  assert.equal(environment.LOGTO_APP_ID, testEnvironment.LOGTO_APP_ID);
  assert.equal(environment.LOGTO_APP_SECRET, ' credential-with-intentional-spaces ');
  assert.equal(environment.LOGTO_COOKIE_SECRET, testEnvironment.LOGTO_COOKIE_SECRET);
});

test('rejects every missing, empty, or whitespace-only required value', () => {
  for (const key of [
    'DATABASE_URL',
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

test('authorization configuration is local and needs no Logto Management credentials', () => {
  const result = createApplicationEnv(testEnvironment);
  assert.equal('LOGTO_MANAGEMENT_APP_SECRET' in result, false);
  assert.equal('LOGTO_ORGANIZATION_ID' in result, false);
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
  for (const baseUrl of ['https://dott.wtf', 'https://dott.wtf/']) {
    assert.equal(
      createApplicationEnv({ ...testEnvironment, LOGTO_BASE_URL: baseUrl }).LOGTO_BASE_URL,
      'https://dott.wtf'
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
    'ftp://dott.wtf',
    'https://user:password@dott.wtf',
    'https://dott.wtf/profile',
    'https://dott.wtf?next=https://example.org',
    'https://dott.wtf#fragment',
    'https://dott.wtf/../',
    ' https://dott.wtf',
    'https:\\dott.wtf',
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
      LOGTO_BASE_URL: 'https://dott.wtf',
    }).LOGTO_BASE_URL,
    'https://dott.wtf'
  );
  assert.equal(
    createApplicationEnv({ ...testEnvironment, NODE_ENV: 'development' }).LOGTO_BASE_URL,
    testEnvironment.LOGTO_BASE_URL
  );
});

test('Vercel Preview derives HTTPS from its stable branch hostname when the origin is absent', () => {
  for (const baseUrl of [undefined, '']) {
    const input = {
      ...testEnvironment,
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'project-git-feature-team.vercel.app',
      VERCEL_URL: 'project-deployment-hash-team.vercel.app',
      LOGTO_BASE_URL: baseUrl,
    };
    assert.equal(
      createApplicationEnv(input).LOGTO_BASE_URL,
      'https://project-git-feature-team.vercel.app'
    );
    assert.equal(input.LOGTO_BASE_URL, baseUrl);
  }
});

test('explicit Preview origins win and keep their existing validation', () => {
  const input = {
    ...testEnvironment,
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
    VERCEL_BRANCH_URL: 'https://malformed-unused-hostname.example',
  };
  for (const hostname of ['custom-preview.example.org', 'project-git-existing-team.vercel.app']) {
    assert.equal(
      createApplicationEnv({ ...input, LOGTO_BASE_URL: `https://${hostname}/` }).LOGTO_BASE_URL,
      `https://${hostname}`
    );
  }
  for (const baseUrl of [' ', 'http://preview.example.org', 'https://preview.example.org/path']) {
    assert.throws(
      () => createApplicationEnv({ ...input, LOGTO_BASE_URL: baseUrl }),
      /LOGTO_BASE_URL/
    );
  }
});

test('Preview rejects missing or malformed branch hostnames without exposing their values', () => {
  for (const hostname of [
    undefined,
    '',
    ' ',
    'https://preview.example.org',
    '//preview.example.org',
    'preview.example.org/path',
    'preview.example.org?query=value',
    'preview.example.org#fragment',
    'user:password@preview.example.org',
    'preview.example.org:443',
    ' preview.example.org',
    'preview.example.org\n',
    'preview. example.org',
    'preview..example.org',
    '-preview.example.org',
    'preview-.example.org',
    'preview_name.example.org',
    'preview.example.org.',
    'preview\\example.org',
    'preview%2eexample.org',
    '127.0.0.1',
    '[::1]',
    `${'a'.repeat(64)}.example.org`,
    `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.org`,
  ]) {
    assert.throws(
      () => createApplicationEnv({
        ...testEnvironment,
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: hostname,
        VERCEL_URL: 'project-deployment-hash-team.vercel.app',
        LOGTO_BASE_URL: undefined,
      }),
      { message: 'Invalid environment variables: VERCEL_BRANCH_URL' }
    );
  }
});

test('production and local environments still require an explicit origin', () => {
  for (const vercelEnv of [undefined, '', 'development', 'production']) {
    for (const nodeEnv of ['development', 'production']) {
      const input = {
        ...testEnvironment,
        NODE_ENV: nodeEnv,
        VERCEL_ENV: vercelEnv,
        VERCEL_BRANCH_URL: 'project-git-feature-team.vercel.app',
      };
      for (const baseUrl of [undefined, '']) {
        assert.throws(
          () => createApplicationEnv({ ...input, LOGTO_BASE_URL: baseUrl }),
          /LOGTO_BASE_URL/
        );
      }
      assert.equal(
        createApplicationEnv({ ...input, LOGTO_BASE_URL: 'https://dott.wtf' }).LOGTO_BASE_URL,
        'https://dott.wtf'
      );
    }
  }
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
      LOGTO_BASE_URL: 'https://private-user:private-password@dott.wtf',
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
