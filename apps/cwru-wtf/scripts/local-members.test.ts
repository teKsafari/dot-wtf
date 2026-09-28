import './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthorizationError, createDashboardAuthorization, dashboardPermissions,
  type LocalMemberAccess,
} from '../lib/authorization';
import { createMemberDirectory, type DirectoryRecord } from '../lib/member-directory';
import { MemberError, createMemberService } from '../lib/members';
import { readMemberInput } from '../lib/member-input';
import { assertSameOriginMutation } from '../lib/member-request';
import type { AuthContextType } from '../lib/tekid/types';

const claims = { sub: 'ada', name: 'Ada', email: 'ada@example.org', email_verified: true, username: null, picture: null };
const auth: AuthContextType = { isAuthenticated: true, claims };
const isStatus = (status: number) => (error: unknown) =>
  (error instanceof AuthorizationError || error instanceof MemberError) && error.status === status;

test('local approved roles alone determine dashboard permissions on each request', async () => {
  let member: LocalMemberAccess | null = { status: 'approved', role: 'admin' };
  let lookups = 0;
  const service = createDashboardAuthorization({
    getAuthContext: async () => auth,
    findMember: async () => { lookups++; return member; },
  });
  assert.deepEqual((await service.requireDashboardPermission('members:assign-roles')).permissions, [...dashboardPermissions]);
  member = { status: 'approved', role: 'instance-lead' };
  assert.equal((await service.requireDashboardPermission('members:review')).role, 'instance-lead');
  await assert.rejects(service.requireDashboardPermission('members:assign-roles'), isStatus(403));
  await assert.rejects(service.requireDashboardPermission('members:renumber'), isStatus(403));
  for (const status of ['draft', 'pending', 'rejected', 'suspended'] as const) {
    member = { status, role: 'admin' };
    await assert.rejects(service.requireDashboardPermission('members:read'), isStatus(403));
  }
  member = { status: 'approved', role: 'member' };
  await assert.rejects(service.requireDashboardPermission('members:read'), isStatus(403));
  member = null;
  await assert.rejects(service.requireDashboardPermission('members:read'), isStatus(403));
  assert.equal(lookups, 10);
});

test('signed-out authorization performs no database lookup and failed lookups deny access', async () => {
  const signedOut = createDashboardAuthorization({
    getAuthContext: async () => ({ isAuthenticated: false, claims: null }),
    findMember: async () => { throw new Error('must not query'); },
  });
  assert.deepEqual(await signedOut.getDashboardAuthContext(), { isAuthenticated: false });
  await assert.rejects(signedOut.requireDashboardPermission('members:read'), isStatus(401));
  const failed = createDashboardAuthorization({ getAuthContext: async () => auth, findMember: async () => { throw new Error('DB connection details'); } });
  await assert.rejects(failed.getDashboardAuthContext(), isStatus(503));
});

const record = (id: string, overrides: Partial<DirectoryRecord> = {}): DirectoryRecord => ({
  id, name: id, picture: null, bio: 'Bio', socialLinks: {}, memberNumber: 1, status: 'approved', ...overrides,
});

test('directory permits only approved local members and projects only public fields', async () => {
  let rows = [
    { ...record('ada'), email: 'private@example.org', wtfIdea: 'private', role: 'admin', userId: 'local-user-uuid', membershipId: 'local-membership-uuid' },
    record('grace', { memberNumber: 2, picture: 'javascript:alert(1)', socialLinks: { github: 'grace', portfolio: 'javascript:alert(1)' } }),
    record('suspended', { status: 'suspended' }),
    record('pending', { status: 'pending' }),
  ];
  const directory = createMemberDirectory({ getAuthContext: async () => auth, loadMembers: async () => rows });
  assert.deepEqual(await directory(), {
    status: 'member', viewerId: 'ada', members: [
      { id: 'ada', name: 'ada', picture: null, bio: 'Bio', links: {}, memberNumber: 1 },
      { id: 'grace', name: 'grace', picture: null, bio: 'Bio', links: { github: 'https://github.com/grace' }, memberNumber: 2 },
    ],
  });
  rows = rows.map((member) => member.id === 'ada' ? { ...member, status: 'suspended' } : member);
  assert.deepEqual(await directory(), { status: 'not-member' });
  assert.deepEqual(await createMemberDirectory({
    getAuthContext: async () => ({ isAuthenticated: false, claims: null }),
    loadMembers: async () => { throw new Error('must not query'); },
  })(), { status: 'signed-out' });
  await assert.rejects(createMemberDirectory({ getAuthContext: async () => auth, loadMembers: async () => { throw new Error('unavailable'); } })());
});

test('signed-out member mutations never enter a transaction', async () => {
  const service = createMemberService({
    getAuthContext: async () => ({ isAuthenticated: false, claims: null }),
    store: { transaction: async () => { throw new Error('must not transact'); } },
  });
  await assert.rejects(service.reviewMember('ada', { action: 'approve' }), isStatus(401));
  await assert.rejects(service.listMembers(), isStatus(401));
});

test('member input requires bounded valid JSON and same-origin mutations', async () => {
  const origin = 'https://cwru.wtf';
  assertSameOriginMutation(new Request(`${origin}/api/admin/members/ada`, { headers: { origin } }), origin);
  for (const source of [undefined, 'https://attacker.example', 'null']) {
    assert.throws(() => assertSameOriginMutation(new Request(`${origin}/api/admin/members/ada`, {
      headers: source ? { origin: source } : {},
    }), origin), isStatus(403));
  }
  const request = (body: string, type = 'application/json') => new Request(`${origin}/api/admin/members/ada`, {
    method: 'PATCH', headers: { 'content-type': type }, body,
  });
  assert.deepEqual(await readMemberInput(request('{"action":"approve"}')), { action: 'approve' });
  await assert.rejects(readMemberInput(request('[]', 'text/plain')), isStatus(400));
  await assert.rejects(readMemberInput(request('{')), isStatus(400));
  await assert.rejects(readMemberInput(request(JSON.stringify({ data: 'x'.repeat(9_000) }))), isStatus(400));
});
