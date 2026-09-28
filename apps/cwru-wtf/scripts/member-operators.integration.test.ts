import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../lib/schema';
import { maximumMemberNumber } from '../lib/members';
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
const profile = (id: string, changes: Partial<typeof schema.memberProfiles.$inferInsert> = {}): typeof schema.memberProfiles.$inferInsert => ({
  tekidUserId: id, name: `Local ${id}`, email: `${id}@example.org`, emailVerified: true, ...changes,
});

describe('membership operator Postgres integration', { skip: !testUrl, concurrency: false }, () => {
  const client = postgres(testUrl!, { max: 3, onnotice: () => {} });
  const database = drizzle(client, { schema });
  const runImport = (members: LegacyMember[], apply = true) => importLegacyMembers(database, {
    members, apply, organizationId: 'test-organization', adminRoleId: 'admin-role', instanceLeadRoleId: 'lead-role',
  });
  const read = async (id: string) => (await database.select().from(schema.memberProfiles).where(eq(schema.memberProfiles.tekidUserId, id)))[0];
  const snapshot = async () => ({
    profiles: await database.select().from(schema.memberProfiles).orderBy(schema.memberProfiles.tekidUserId),
    counters: await database.select().from(schema.memberNumberCounter).orderBy(schema.memberNumberCounter.id),
    audits: await database.select().from(schema.memberAuditLogs).orderBy(schema.memberAuditLogs.id),
  });

  before(async () => {
    const [identity] = await client`SELECT current_database() AS name`;
    assert.equal(identity!.name, new URL(testUrl!).pathname.slice(1));
    await migrate(database, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    await client`TRUNCATE TABLE member_profiles, member_audit_logs, member_number_counter RESTART IDENTITY`;
  });

  test('dry-run import and bootstrap leave profiles, counters, and audit rows unchanged', async () => {
    await database.insert(schema.memberProfiles).values(profile('existing', { bio: 'Keep these answers' }));
    await database.insert(schema.memberNumberCounter).values({ id: 1, nextNumber: 10 });
    await database.insert(schema.memberAuditLogs).values({ actorId: 'existing', targetId: 'existing', action: 'profile.save' });
    const before = await snapshot();
    const planned = await runImport([legacyMember('new'), legacyMember('existing', { createdAt: 1000 })], false);
    assert.deepEqual(planned.map(({ memberNumber }) => memberNumber), [10, 11]);
    await bootstrapLocalMember(database, { email: 'existing@example.org', role: 'admin', dryRun: true });
    assert.deepEqual(await snapshot(), before);
  });

  test('apply imports role/status/number order and preserves all existing form answers', async () => {
    await database.insert(schema.memberProfiles).values(profile('existing', {
      name: 'User chosen name', categories: ['Research'], institution: 'CWRU, Cleveland', otherCategory: '',
      whatsapp: '+15550001111', bio: 'Original bio', wtfIdea: 'Original idea', currentProject: 'Original project',
      youtubeLink: 'https://youtu.be/old', socialLinks: { github: 'https://github.com/original' },
    }));
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
    assert.equal(state.counters[0]!.nextNumber, 4);
    assert.equal(state.audits.length, 3);
    assert(state.audits.every(({ action }) => action === importAuditAction));
  });

  test('rerunning cannot restore a revoked role/status or recreate a deleted imported profile', async () => {
    const source = [legacyMember('revoked', { organizationRoles: [{ id: 'admin-role' }] }), legacyMember('deleted')];
    await runImport(source);
    await database.update(schema.memberProfiles).set({ status: 'suspended', role: 'member' }).where(eq(schema.memberProfiles.tekidUserId, 'revoked'));
    await database.delete(schema.memberProfiles).where(eq(schema.memberProfiles.tekidUserId, 'deleted'));
    const before = await snapshot();
    const result = await runImport(source);
    assert(result.every(({ outcome }) => outcome === 'already-imported'));
    assert.deepEqual(await snapshot(), before);
    assert.equal(await read('deleted'), undefined);
    assert.equal((await read('revoked'))!.role, 'member');
  });

  test('current local decisions are skipped and durably marked without changing profile answers', async () => {
    await database.insert(schema.memberProfiles).values([
      profile('pending', { status: 'pending' }), profile('rejected', { status: 'rejected' }),
      profile('approved', { status: 'approved', role: 'admin', memberNumber: 8, approvedAt: new Date(1000) }),
    ]);
    await database.insert(schema.memberAuditLogs).values({ actorId: 'operator', targetId: 'deleted-local', action: 'member.bootstrap' });
    const before = (await snapshot()).profiles;
    const source = ['pending', 'rejected', 'approved', 'deleted-local'].map((id) => legacyMember(id));
    assert((await runImport(source)).every(({ outcome }) => outcome === 'local-decision'));
    assert.deepEqual((await snapshot()).profiles, before);
    assert.equal((await snapshot()).counters.length, 0);
    assert.equal((await snapshot()).audits.filter(({ action }) => action === importAuditAction).length, 4);
    const after = await snapshot();
    assert((await runImport(source)).every(({ outcome }) => outcome === 'already-imported'));
    assert.deepEqual(await snapshot(), after);
  });

  test('exhausted allocation rolls back earlier imported profiles, numbers, and audit rows', async () => {
    await database.insert(schema.memberNumberCounter).values({ id: 1, nextNumber: maximumMemberNumber });
    const before = await snapshot();
    await assert.rejects(runImport([legacyMember('first'), legacyMember('second')]), /Not enough automatic member numbers/);
    assert.deepEqual(await snapshot(), before);
  });

  test('bootstrap grants a verified local profile once and preserves its number on rerun', async () => {
    await database.insert(schema.memberProfiles).values(profile('operator', { status: 'pending', email: 'Operator@Example.org' }));
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
