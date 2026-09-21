import './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeDashboardHint, encodeDashboardHint } from '../lib/tekid/dashboard-hint';

const scope = { sub: 'user-1', organizationId: 'cwru', secret: 'test-cookie-secret-at-least-32-characters' };
const future = Date.now() + 60_000;

test('round-trips the verdict for the same user and organization', () => {
  assert.equal(decodeDashboardHint(encodeDashboardHint(true, future, scope), scope), true);
  assert.equal(decodeDashboardHint(encodeDashboardHint(false, future, scope), scope), false);
});

test('rejects hints bound to another user, organization, or secret', () => {
  const hint = encodeDashboardHint(true, future, scope);
  assert.equal(decodeDashboardHint(hint, { ...scope, sub: 'user-2' }), null);
  assert.equal(decodeDashboardHint(hint, { ...scope, organizationId: 'other-instance' }), null);
  assert.equal(decodeDashboardHint(hint, { ...scope, secret: 'another-cookie-secret-of-32-characters!' }), null);
});

test('rejects expired hints', () => {
  const expiresAt = Date.now() + 1_000;
  const hint = encodeDashboardHint(true, expiresAt, scope);
  assert.equal(decodeDashboardHint(hint, scope, expiresAt - 1), true);
  assert.equal(decodeDashboardHint(hint, scope, expiresAt), null);
});

test('rejects tampered and malformed hints', () => {
  const hint = encodeDashboardHint(false, future, scope);
  assert.equal(decodeDashboardHint(hint.replace('v1.0', 'v1.1'), scope), null);
  assert.equal(decodeDashboardHint(undefined, scope), null);
  assert.equal(decodeDashboardHint('', scope), null);
  assert.equal(decodeDashboardHint('v1.1.garbage.signature', scope), null);
});
