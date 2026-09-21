import assert from 'node:assert/strict';
import test from 'node:test';

import { getTekidReturnPath } from '../lib/tekid/redirects';

test('sign-in supports only the profile and dashboard destinations', () => {
  assert.equal(getTekidReturnPath('/admin'), '/admin');
  assert.equal(getTekidReturnPath('/profile'), '/profile');

  for (const destination of [
    undefined, null, '', ['/admin'], '/admin?role=admin', '/api/admin/members',
    'https://example.com', '//example.com', '/\\example.com', '/%2fexample.com',
    '/profile/../admin', '/admin#fragment', 'https://cwru.wtf/admin',
  ]) {
    assert.equal(getTekidReturnPath(destination), '/profile');
  }
});
