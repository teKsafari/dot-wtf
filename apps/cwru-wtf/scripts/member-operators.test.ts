import assert from 'node:assert/strict';
import test from 'node:test';
import { importAuditAction, planBootstrap, planLegacyImport, readLegacyMembers, type LegacyMember, type OperatorProfile } from './member-operator-logic';

const member = (id: string, changes: Partial<LegacyMember> = {}): LegacyMember => ({
  id, name: 'Test Member', primaryEmail: 'member@example.org', avatar: null,
  isSuspended: false, createdAt: 1000, organizationRoles: [], ...changes,
});
const profile = (id: string, changes: Partial<OperatorProfile> = {}): OperatorProfile => ({
  tekidUserId: id, name: 'Local Member', email: 'member@example.org', emailVerified: true,
  role: 'member', status: 'draft', memberNumber: null, approvedAt: null, reviewedAt: null, reviewedBy: null, ...changes,
});
const plan = (members: LegacyMember[], profiles: OperatorProfile[] = [], priorDecisions: { targetId: string; action: string }[] = []) => planLegacyImport({
  members, profiles, priorDecisions, adminRoleId: 'admin-role', instanceLeadRoleId: 'lead-role',
});

test('bootstrap requires one verified local profile and refuses ambiguous emails', () => {
  assert.throws(() => planBootstrap([], 'admin'), /sign in/);
  assert.throws(() => planBootstrap([profile('one'), profile('two')], 'admin'), /More than one/);
  assert.throws(() => planBootstrap([profile('one', { emailVerified: false })], 'admin'), /verified email/);
  assert.throws(() => planBootstrap([profile('one', { email: '' })], 'admin'), /verified email/);
  assert.equal(planBootstrap([profile('one')], 'admin').unchanged, false);
});

test('bootstrap cannot silently restore revoked access or demote an administrator', () => {
  for (const status of ['suspended', 'rejected'] as const) assert.throws(() => planBootstrap([profile('one', { status })], 'admin'), /revoked or rejected/);
  assert.throws(() => planBootstrap([profile('one', { status: 'approved', role: 'admin', memberNumber: 3 })], 'instance-lead'), /cannot demote/);
  assert.equal(planBootstrap([profile('one', { status: 'approved', role: 'admin', memberNumber: 3 })], 'admin').unchanged, true);
});

test('import keeps role precedence and suspended membership without activating it', () => {
  const decisions = plan([
    member('admin', { organizationRoles: [{ id: 'lead-role' }, { id: 'admin-role' }] }),
    member('lead', { organizationRoles: [{ id: 'lead-role' }] }),
    member('ordinary', { organizationRoles: [{ id: 'unrelated-role' }] }),
    member('suspended', { isSuspended: true, organizationRoles: [{ id: 'admin-role' }] }),
  ]);
  assert.deepEqual(decisions.map(({ role, status }) => ({ role, status })), [
    { role: 'admin', status: 'approved' }, { role: 'instance-lead', status: 'approved' },
    { role: 'member', status: 'approved' }, { role: 'admin', status: 'suspended' },
  ]);
});

test('import orders by membership time when present, otherwise account creation with stable ties', () => {
  const decisions = plan([member('z', { createdAt: 2000 }), member('a', { createdAt: 2000 }), member('joined', { joinedAt: 500, createdAt: 9000 })]);
  assert.deepEqual(decisions.map(({ member: { id }, orderingSource }) => [id, orderingSource]), [
    ['joined', 'joinedAt'], ['a', 'createdAt'], ['z', 'createdAt'],
  ]);
});

test('repeat import never regrants revoked local access, even after a profile was deleted', () => {
  const decisions = plan([member('revoked'), member('deleted')], [profile('revoked', { status: 'suspended', role: 'member', memberNumber: 1 })], [
    { targetId: 'revoked', action: importAuditAction }, { targetId: 'deleted', action: importAuditAction },
  ]);
  assert(decisions.every(({ outcome }) => outcome === 'already-imported'));
});

test('import preserves every existing local decision and only hydrates untouched drafts', () => {
  for (const changes of [
    { status: 'pending' as const }, { status: 'approved' as const }, { status: 'rejected' as const },
    { status: 'suspended' as const }, { role: 'admin' as const }, { memberNumber: 7 },
    { reviewedAt: new Date() }, { reviewedBy: 'admin' }, { approvedAt: new Date() },
  ]) assert.equal(plan([member('one')], [profile('one', changes)])[0]?.outcome, 'local-decision');
  assert.equal(plan([member('one')], [profile('one')], [{ targetId: 'one', action: 'member.bootstrap' }])[0]?.outcome, 'local-decision');
  assert.equal(plan([member('one')], [profile('one')], [{ targetId: 'one', action: 'profile.save' }])[0]?.outcome, 'import');
});

test('import rejects duplicate identities and indistinguishable privileged role configuration', () => {
  assert.throws(() => plan([member('same'), member('same')]), /duplicate/);
  assert.throws(() => planLegacyImport({ members: [], profiles: [], priorDecisions: [], adminRoleId: 'same', instanceLeadRoleId: 'same' }), /distinct/);
});

test('snapshot reader honors reported totals even when the API returns small pages', async () => {
  const queries: string[] = [];
  const result = await readLegacyMembers({ async get(path, query) {
    assert.equal(path, '/api/organizations/organization/users');
    queries.push(query!.page!);
    return { data: [member(query!.page!)], total: '2' };
  } }, 'organization');
  assert.deepEqual(queries, ['1', '2']);
  assert.deepEqual(result.map(({ id }) => id), ['1', '2']);
});

test('snapshot reader aborts on duplicate pages, changing counts, missing rows, or malformed data', async () => {
  await assert.rejects(readLegacyMembers({ async get() { return { data: [member('same')], total: '2' }; } }, 'org'), /repeated/);
  await assert.rejects(readLegacyMembers({ async get(_path, query) { return { data: [member(query!.page!)], total: query!.page === '1' ? '2' : '3' }; } }, 'org'), /changed/);
  await assert.rejects(readLegacyMembers({ async get() { return { data: [], total: '2' }; } }, 'org'), /reported total/);
  await assert.rejects(readLegacyMembers({ async get() { return { data: [{ id: 'private-invalid-snapshot' }], total: null }; } }, 'org'), /invalid member snapshot/);
});
