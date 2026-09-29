import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../lib/schema';
import { maximumMemberNumber } from '../lib/members';
import { findMemberRecordByTekidId, selectMemberRecords, type MemberRecord } from '../lib/member-records';
import { bootstrapLocalMember, importLegacyMembers } from './member-operator-database';
import { importAuditAction, type LegacyMember } from './member-operator-logic';

// These tests reset ONLY an explicitly named disposable loopback database.
// Never infer the target from the application's DATABASE_URL or .env files.
const testUrl = process.env.OPERATOR_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/dot_wtf_[a-z_]+_test$/.test(parsed.pathname)
    || parsed.search || parsed.hash) {
    throw new Error('OPERATOR_TEST_DATABASE_URL must name a disposable local dot_wtf_*_test database without query parameters.');
  }
}

const legacyMember = (id: string, changes: Partial<LegacyMember> = {}): LegacyMember => ({
  id, name: `Logto ${id}`, primaryEmail: `${id}@example.org`, avatar: 'https://images.example.org/avatar.png',
  isSuspended: false, createdAt: 2000, organizationRoles: [], ...changes,
});

describe('membership operator Postgres integration', { skip: !testUrl, concurrency: false }, () => {
  const client = postgres(testUrl!, { max: 3, onnotice: () => {} });
  const database = drizzle(client, { schema });
  const runImport = (members: LegacyMember[], apply = true) => importLegacyMembers(database, {
    members, apply, organizationId: 'test-organization', adminRoleId: 'admin-role', instanceLeadRoleId: 'lead-role',
  });
  const read = async (id: string) => (await findMemberRecordByTekidId(database, id)) ?? undefined;
  async function seed(id: string, changes: Partial<MemberRecord> = {}) {
    const values = { name: `Local ${id}`, email: `${id}@example.org`, emailVerified: true, ...changes };
    const [user] = await database.insert(schema.users).values({ tekidUserId: id, email: values.email, emailVerified: values.emailVerified }).returning();
    const profileValues = Object.fromEntries(Object.keys(getTableColumns(schema.profiles)).filter((key) => key in values).map((key) => [key, values[key as keyof typeof values]]));
    const membershipValues = Object.fromEntries(Object.keys(getTableColumns(schema.memberships)).filter((key) => key in values).map((key) => [key, values[key as keyof typeof values]]));
    await database.insert(schema.profiles).values({ ...profileValues, userId: user!.id });
    await database.insert(schema.memberships).values({ ...membershipValues, userId: user!.id });
    return (await read(id))!;
  }
  const setNext = async (value: number) => { await client`select setval('member_number_seq', ${value}, false)`; };
  const nextSequence = async () => {
    const [row] = await client`select last_value::text, is_called from member_number_seq`;
    return Number(row!.last_value) + (row!.is_called ? 1 : 0);
  };
  const snapshot = async () => ({
    profiles: await selectMemberRecords(database).orderBy(schema.users.tekidUserId),
    users: await database.select().from(schema.users).orderBy(schema.users.tekidUserId),
    nextNumber: await nextSequence(),
    audits: await database.select().from(schema.memberAuditLogs).orderBy(schema.memberAuditLogs.id),
  });

  before(async () => {
    const [identity] = await client`SELECT current_database() AS name`;
    assert.equal(identity!.name, new URL(testUrl!).pathname.slice(1));
    await migrate(database, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    await client`TRUNCATE TABLE users, profiles, memberships, member_audit_logs RESTART IDENTITY CASCADE`;
    await client`ALTER SEQUENCE member_number_seq RESTART WITH 1`;
  });

  test('dry-run import and bootstrap leave profiles, sequence, and audit rows unchanged', async () => {
    await seed('existing', { bio: 'Keep these answers' });
    await setNext(10);
    await database.insert(schema.memberAuditLogs).values({ actorId: 'existing', targetId: 'existing', action: 'profile.save' });
    const before = await snapshot();
    const planned = await runImport([legacyMember('new'), legacyMember('existing', { createdAt: 1000 })], false);
    assert.deepEqual(planned.map(({ memberNumber }) => memberNumber), [10, 11]);
    await bootstrapLocalMember(database, { email: 'existing@example.org', role: 'admin', dryRun: true });
    assert.deepEqual(await snapshot(), before);
  });

  test('apply imports role/status/number order and preserves all existing form answers', async () => {
    await seed('existing', {
      name: 'User chosen name', categories: ['Research'], institution: 'CWRU, Cleveland', otherCategory: '',
      whatsapp: '+15550001111', bio: 'Original bio', wtfIdea: 'Original idea', currentProject: 'Original project',
      youtubeLink: 'https://youtu.be/old', socialLinks: { github: 'https://github.com/original' },
    });
    const before = (await read('existing'))!;
    const result = await runImport([
      legacyMember('suspended', { createdAt: 3000, isSuspended: true, organizationRoles: [{ id: 'lead-role' }] }),
      legacyMember('existing', { createdAt: 2000 }),
      legacyMember('admin', { joinedAt: 1000, createdAt: 9000, organizationRoles: [{ id: 'lead-role' }, { id: 'admin-role' }] }),
    ]);
    assert.deepEqual(result.map(({ userId, role, status, memberNumber }) => [userId, role, status, memberNumber]), [
      ['admin', 'admin', 'approved', 1], ['existing', 'member', 'approved', 2], ['suspended', 'instance-lead', 'suspended', 3],
    ]);
    const existing = (await read('existing'))!;
    for (const key of ['name', 'categories', 'institution', 'otherCategory', 'whatsapp', 'bio', 'wtfIdea', 'currentProject', 'youtubeLink', 'socialLinks'] as const) {
      assert.deepEqual(existing[key], before[key]);
    }
    assert.equal(existing.emailVerified, true);
    assert.equal((await read('admin'))!.emailVerified, false);
    assert.equal((await read('admin'))!.approvedAt!.getTime(), 1000);
    const state = await snapshot();
    assert.equal(state.nextNumber, 4);
    assert.equal(state.audits.length, 3);
    assert(state.audits.every(({ action }) => action === importAuditAction));
  });

  test('rerunning cannot restore a revoked role/status or recreate a deleted imported profile', async () => {
    const source = [legacyMember('revoked', { organizationRoles: [{ id: 'admin-role' }] }), legacyMember('deleted')];
    await runImport(source);
    await database.update(schema.memberships).set({ status: 'suspended', role: 'member' }).where(eq(schema.memberships.userId, (await read('revoked'))!.userId));
    await database.delete(schema.users).where(eq(schema.users.tekidUserId, 'deleted'));
    const before = await snapshot();
    const result = await runImport(source);
    assert(result.every(({ outcome }) => outcome === 'already-imported'));
    assert.deepEqual(await snapshot(), before);
    assert.equal(await read('deleted'), undefined);
    assert.equal((await read('revoked'))!.role, 'member');
  });

  test('current local decisions are skipped and durably marked without changing profile answers', async () => {
    await seed('pending', { status: 'pending' });
    await seed('rejected', { status: 'rejected' });
    await seed('approved', { status: 'approved', role: 'admin', memberNumber: 8, approvedAt: new Date(1000) });
    await database.insert(schema.memberAuditLogs).values({ actorId: 'operator', targetId: 'deleted-local', action: 'member.bootstrap' });
    const before = await snapshot();
    const source = ['pending', 'rejected', 'approved', 'deleted-local'].map((id) => legacyMember(id));
    assert((await runImport(source)).every(({ outcome }) => outcome === 'local-decision'));
    assert.deepEqual((await snapshot()).profiles, before.profiles);
    assert.equal((await snapshot()).nextNumber, before.nextNumber);
    assert.equal((await snapshot()).audits.filter(({ action }) => action === importAuditAction).length, 4);
    const after = await snapshot();
    assert((await runImport(source)).every(({ outcome }) => outcome === 'already-imported'));
    assert.deepEqual(await snapshot(), after);
  });

  test('import allocation advances past canonical member numbers without a counter bridge', async () => {
    await seed('existing-number', { status: 'approved', memberNumber: 8, approvedAt: new Date(1000) });
    // Direct fixtures do not call the allocator. The runtime reconciles an older
    // sequence with canonical numbers when it actually reserves a new number.
    assert.equal(await nextSequence(), 1);
    const before = await snapshot();
    assert.equal((await runImport([legacyMember('new')], false))[0]!.memberNumber, 9);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await runImport([legacyMember('new')]))[0]!.memberNumber, 9);
    assert.equal(await nextSequence(), 10);
  });

  test('exhausted allocation rolls back earlier imported profiles, numbers, and audit rows', async () => {
    await setNext(maximumMemberNumber);
    const before = await snapshot();
    await assert.rejects(runImport([legacyMember('first'), legacyMember('second')]), /Not enough automatic member numbers/);
    assert.deepEqual(await snapshot(), before);
  });

  test('import handles identities without profiles and preserves membership decisions independently', async () => {
    const [empty] = await database.insert(schema.users).values({ tekidUserId: 'identity-only', email: 'identity-only@example.org', emailVerified: true }).returning();
    const [revoked] = await database.insert(schema.users).values({ tekidUserId: 'no-profile-revoked' }).returning();
    await database.insert(schema.memberships).values({ userId: revoked!.id, status: 'suspended' });
    const result = await runImport([legacyMember('identity-only'), legacyMember('no-profile-revoked', { organizationRoles: [{ id: 'admin-role' }] })]);
    assert.equal(result.find(({ userId }) => userId === 'identity-only')!.outcome, 'import');
    assert.equal((await read('identity-only'))!.userId, empty!.id);
    assert.equal((await read('identity-only'))!.emailVerified, true);
    assert.equal(result.find(({ userId }) => userId === 'no-profile-revoked')!.outcome, 'local-decision');
    const [membership] = await database.select().from(schema.memberships).where(eq(schema.memberships.userId, revoked!.id));
    assert.equal(membership!.status, 'suspended');
    assert.equal(membership!.role, 'member');
    assert.equal(await read('no-profile-revoked'), undefined);
  });

  test('bootstrap grants a verified local profile once and preserves its number on rerun', async () => {
    await seed('operator', { status: 'pending', email: 'Operator@Example.org' });
    const granted = await bootstrapLocalMember(database, { email: 'operator@example.org', role: 'admin', dryRun: false });
    assert.equal(granted.number, 1);
    assert.equal((await read('operator'))!.status, 'approved');
    assert.equal((await read('operator'))!.role, 'admin');
    const before = await snapshot();
    const repeated = await bootstrapLocalMember(database, { userId: 'operator', role: 'admin', dryRun: false });
    assert.equal(repeated.unchanged, true);
    assert.deepEqual(await snapshot(), before);
  });
});
