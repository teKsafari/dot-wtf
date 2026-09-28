import './test-env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../lib/schema';
import { AuthorizationError } from '../lib/authorization';
import {
  createDatabaseMemberStore, createMemberService, maximumMemberNumber, MemberError,
  withMemberMutationLock,
} from '../lib/members';

// Explicit opt-in only: these tests reset a disposable database, never app DATABASE_URL.
const testUrl = process.env.MEMBER_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/dot_wtf_[a-z_]+_test$/.test(parsed.pathname)
    || parsed.search || parsed.hash) {
    throw new Error('MEMBER_TEST_DATABASE_URL must name a disposable local dot_wtf_*_test database without query parameters.');
  }
}

describe('local membership Postgres integration', { skip: !testUrl }, () => {
  const client = postgres(testUrl!, { max: 12, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const store = createDatabaseMemberStore(db);
  const now = new Date('2026-09-28T12:00:00Z');
  const identity = (sub: string) => ({
    isAuthenticated: true as const,
    claims: { sub, name: sub, email: `${sub}@example.org`, email_verified: true, username: null, picture: null },
  });
  const service = (sub = 'admin') => createMemberService({ getAuthContext: async () => identity(sub), store, now: () => now });
  const isStatus = (status: number) => (error: unknown) =>
    (error instanceof MemberError || error instanceof AuthorizationError) && error.status === status;
  const profile = (id: string, changes: Partial<typeof schema.memberProfiles.$inferInsert> = {}): typeof schema.memberProfiles.$inferInsert => ({
    tekidUserId: id, name: `Name ${id}`, email: `${id}@example.org`, emailVerified: true,
    categories: ['Software / Coding'], institution: 'CWRU, Cleveland', whatsapp: '+15555550123',
    wtfIdea: 'Build something surprising', currentProject: 'A useful project',
    youtubeLink: 'https://youtube.com/watch?v=test', socialLinks: { portfolio: 'https://example.org' },
    status: 'pending', submittedAt: now, ...changes,
  });
  const read = async (id: string) => (await db.select().from(schema.memberProfiles).where(eq(schema.memberProfiles.tekidUserId, id)))[0]!;

  before(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    await db.execute(sql`truncate table member_audit_logs, member_profiles, member_number_counter restart identity`);
    await db.insert(schema.memberNumberCounter).values({ id: 1, nextNumber: 1 });
    await db.insert(schema.memberProfiles).values([
      profile('admin', { role: 'admin', status: 'approved', memberNumber: 1, approvedAt: now }),
      profile('lead', { role: 'instance-lead', status: 'approved', memberNumber: 2, approvedAt: now }),
    ]);
  });

  test('concurrent approvals allocate unique sequential numbers and commit audits together', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `applicant-${index}`);
    await db.insert(schema.memberProfiles).values(ids.map((id) => profile(id)));
    const members = await Promise.all(ids.map((id) => service('lead').reviewMember(id, { action: 'approve' })));
    assert.deepEqual(members.map((member) => member.memberNumber).sort((a, b) => a! - b!), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.ok(members.every((member) => member.status === 'approved' && member.role === 'member'));
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 10);
    assert.equal((await db.select().from(schema.memberNumberCounter))[0]!.nextNumber, 13);
  });

  test('custom number conflicts return 409 and rollback status, counter, and audit', async () => {
    await db.insert(schema.memberProfiles).values([profile('one'), profile('two')]);
    const results = await Promise.allSettled(['one', 'two'].map((id) => service().reviewMember(id, { action: 'approve', memberNumber: 50 })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(isStatus(409)(rejected.reason));
    assert.equal((await db.select().from(schema.memberProfiles).where(eq(schema.memberProfiles.status, 'pending'))).length, 1);
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 1);
    assert.equal((await db.select().from(schema.memberNumberCounter))[0]!.nextNumber, 51);
    const loser = (await read('one')).status === 'pending' ? 'one' : 'two';
    assert.equal((await service().reviewMember(loser, { action: 'approve' })).memberNumber, 51);
  });

  test('manual renumbering advances the counter and never reuses previously assigned numbers', async () => {
    await db.insert(schema.memberProfiles).values([profile('one'), profile('two'), profile('three')]);
    assert.equal((await service().reviewMember('one', { action: 'approve', memberNumber: 100 })).memberNumber, 100);
    assert.equal((await service().reviewMember('two', { action: 'approve' })).memberNumber, 101);
    await service().reviewMember('one', { action: 'set-number', memberNumber: 5 });
    assert.equal((await service().reviewMember('three', { action: 'approve' })).memberNumber, 102);
    await assert.rejects(service().reviewMember('one', { action: 'set-number', memberNumber: 2 }), isStatus(409));
    assert.equal((await read('one')).memberNumber, 5);
  });

  test('approval enforces submitted, complete, verified applications; restoration preserves history', async () => {
    await db.insert(schema.memberProfiles).values([
      profile('draft', { status: 'draft' }), profile('incomplete', { wtfIdea: '' }),
      profile('unverified', { emailVerified: false }), profile('unsubmitted', { submittedAt: null }),
      profile('never-approved', { status: 'suspended', wtfIdea: '', submittedAt: null }),
      profile('former', { status: 'suspended', memberNumber: 90, approvedAt: new Date('2025-01-01'), wtfIdea: '', institution: '', submittedAt: null }),
    ]);
    for (const id of ['draft', 'incomplete', 'unverified', 'unsubmitted', 'never-approved']) {
      await assert.rejects(service().reviewMember(id, { action: 'approve' }), isStatus(409));
    }
    const restored = await service().reviewMember('former', { action: 'approve' });
    assert.equal(restored.memberNumber, 90);
    assert.equal(restored.approvedAt, '2025-01-01T00:00:00.000Z');
    assert.equal(restored.role, 'member');
    assert.equal((await service().reviewMember('incomplete', { action: 'reject' })).status, 'rejected');
    await assert.rejects(service().reviewMember('incomplete', { action: 'suspend' }), isStatus(409));
  });

  test('instance leads cannot renumber, assign roles, or review staff', async () => {
    await db.insert(schema.memberProfiles).values([profile('applicant'), profile('staff', { role: 'instance-lead' })]);
    for (const [id, action] of [
      ['applicant', { action: 'approve', memberNumber: 12 }],
      ['admin', { action: 'suspend' }],
      ['staff', { action: 'approve' }],
      ['admin', { action: 'set-number', memberNumber: 3 }],
      ['applicant', { action: 'set-role', role: 'admin' }],
    ] as const) {
      await assert.rejects(service('lead').reviewMember(id, action), isStatus(403));
    }
    assert.equal((await service('lead').reviewMember('applicant', { action: 'approve' })).role, 'member');
  });

  test('a queued mutation rechecks the actor after revocation under the shared lock', async () => {
    await db.insert(schema.memberProfiles).values(profile('applicant'));
    let pending: Promise<unknown> | undefined;
    await withMemberMutationLock(db, async (transaction) => {
      pending = service('lead').reviewMember('applicant', { action: 'approve' });
      // Attach a handler immediately so rejection is observed even on very fast hosts.
      void pending.catch(() => {});
      await transaction.update(schema.memberProfiles).set({ role: 'member' }).where(eq(schema.memberProfiles.tekidUserId, 'lead'));
    });
    await assert.rejects(pending!, isStatus(403));
    assert.equal((await read('applicant')).status, 'pending');
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 0);
  });

  test('admins can revoke suspended staff roles without restoring access', async () => {
    await db.insert(schema.memberProfiles).values(profile('suspended-staff', {
      status: 'suspended', role: 'admin', memberNumber: 3, approvedAt: now,
    }));
    await assert.rejects(service('lead').reviewMember('suspended-staff', { action: 'set-role', role: 'member' }), isStatus(403));
    await assert.rejects(service().reviewMember('suspended-staff', { action: 'set-role', role: 'instance-lead' }), isStatus(409));
    const demoted = await service().reviewMember('suspended-staff', { action: 'set-role', role: 'member' });
    assert.equal(demoted.role, 'member');
    assert.equal(demoted.status, 'suspended');
    assert.equal(demoted.memberNumber, 3);
    await assert.rejects(service().reviewMember('suspended-staff', { action: 'set-role', role: 'admin' }), isStatus(409));
  });

  test('self-demotion and suspension fail; two admins cannot concurrently revoke each other', async () => {
    await assert.rejects(service().reviewMember('admin', { action: 'set-role', role: 'member' }), isStatus(409));
    await assert.rejects(service().reviewMember('admin', { action: 'suspend' }), isStatus(409));
    await db.insert(schema.memberProfiles).values(profile('admin-two', { status: 'approved', role: 'admin', memberNumber: 3, approvedAt: now }));
    const results = await Promise.allSettled([
      service().reviewMember('admin-two', { action: 'set-role', role: 'member' }),
      service('admin-two').reviewMember('admin', { action: 'set-role', role: 'member' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(isStatus(403)(rejected.reason));
    const admins = (await db.select().from(schema.memberProfiles)).filter((member) => member.status === 'approved' && member.role === 'admin');
    assert.equal(admins.length, 1);
  });

  test('status filters paginate, protect application details, and reject forged actions', async () => {
    await db.insert(schema.memberProfiles).values(Array.from({ length: 23 }, (_, index) => profile(`pending-${index}`)));
    const first = await service().listMembers(1, 'pending');
    const second = await service().listMembers(2, 'pending');
    assert.equal(first.members.length, 20);
    assert.equal(first.hasMore, true);
    assert.equal(second.members.length, 3);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.members, ...second.members].map((member) => member.id)).size, 23);
    assert.equal(first.members[0]!.fields.whatsapp, '+15555550123');
    await assert.rejects(service('pending-0').listMembers(), isStatus(403));
    for (const mutation of [
      { action: 'approve', role: 'admin' }, { action: 'approve', memberNumber: 0 },
      { action: 'approve', memberNumber: maximumMemberNumber + 1 },
      { action: 'approve', memberNumber: '3' }, { action: 'delete' },
    ]) await assert.rejects(service().reviewMember('pending-0', mutation), isStatus(400));
  });

  test('exhausted integer counter does not overflow or partially approve a member', async () => {
    await db.insert(schema.memberProfiles).values([profile('last'), profile('next')]);
    await service().reviewMember('last', { action: 'approve', memberNumber: maximumMemberNumber });
    await assert.rejects(service().reviewMember('next', { action: 'approve' }), isStatus(409));
    assert.equal((await read('next')).status, 'pending');
    assert.equal((await db.select().from(schema.memberNumberCounter))[0]!.nextNumber, 2_147_483_647);
  });
});
