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
import { createMemberDirectory, loadDirectoryRecords } from '../lib/member-directory';
import { findMemberAccessByTekidId, findMemberRecordByTekidId, selectMemberRecords } from '../lib/member-records';
import {
  createDatabaseMemberStore, createMemberService, maximumMemberNumber, MemberError,
  withMemberMutationLock, peekNextMemberNumber, reserveMemberNumber, type MemberRecord,
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
  const profile = (id: string, changes: Partial<MemberRecord> = {}) => ({
    tekidUserId: id, name: `Name ${id}`, email: `${id}@example.org`, emailVerified: true,
    picture: null, categories: ['Software / Coding'], institution: 'CWRU, Cleveland', otherCategory: '', whatsapp: '+15555550123',
    bio: '', wtfIdea: 'Build something surprising', currentProject: 'A useful project',
    youtubeLink: 'https://youtube.com/watch?v=test', socialLinks: { portfolio: 'https://example.org' },
    role: 'member' as const, status: 'pending' as const, memberNumber: null, submittedAt: now,
    approvedAt: null, reviewedAt: null, reviewedBy: null, ...changes,
  });
  async function insertProfiles(input: ReturnType<typeof profile> | ReturnType<typeof profile>[]) {
    await db.transaction(async (transaction) => {
      for (const member of Array.isArray(input) ? input : [input]) {
        const [user] = await transaction.insert(schema.users).values({
          tekidUserId: member.tekidUserId, email: member.email, emailVerified: member.emailVerified,
        }).returning();
        await transaction.insert(schema.profiles).values({
          userId: user!.id, name: member.name, picture: member.picture,
          categories: member.categories, institution: member.institution, otherCategory: member.otherCategory,
          whatsapp: member.whatsapp, bio: member.bio, wtfIdea: member.wtfIdea,
          currentProject: member.currentProject, youtubeLink: member.youtubeLink, socialLinks: member.socialLinks,
        });
        await transaction.insert(schema.memberships).values({
          userId: user!.id, role: member.role, status: member.status, memberNumber: member.memberNumber,
          submittedAt: member.submittedAt, approvedAt: member.approvedAt, reviewedAt: member.reviewedAt, reviewedBy: member.reviewedBy,
        });
      }
    });
  }
  const read = async (id: string) => {
    const row = await findMemberRecordByTekidId(db, id);
    assert.ok(row);
    return row;
  };
  const nextNumber = () => withMemberMutationLock(db, peekNextMemberNumber);
  async function clearDatabase() {
    await db.execute(sql`truncate table member_audit_logs, memberships, profiles, users restart identity cascade`);
    await db.execute(sql`select setval('member_number_seq', 1, false)`);
  }

  before(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    await clearDatabase();
    await insertProfiles([
      profile('admin', { role: 'admin', status: 'approved', memberNumber: 1, approvedAt: now }),
      profile('lead', { role: 'instance-lead', status: 'approved', memberNumber: 2, approvedAt: now }),
    ]);
  });

  test('concurrent approvals allocate unique sequential numbers and commit audits together', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `applicant-${index}`);
    await insertProfiles(ids.map((id) => profile(id)));
    const members = await Promise.all(ids.map((id) => service('lead').reviewMember(id, { action: 'approve' })));
    assert.deepEqual(members.map((member) => member.memberNumber).sort((a, b) => a! - b!), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.ok(members.every((member) => member.status === 'approved' && member.role === 'member'));
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 10);
    assert.equal(await nextNumber(), 13);
  });

  test('custom number conflicts return 409 without allocating another sequence number', async () => {
    await insertProfiles([profile('one'), profile('two')]);
    const results = await Promise.allSettled(['one', 'two'].map((id) => service().reviewMember(id, { action: 'approve', memberNumber: 50 })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(isStatus(409)(rejected.reason));
    assert.equal((await selectMemberRecords(db).where(eq(schema.memberships.status, 'pending'))).length, 1);
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 1);
    assert.equal(await nextNumber(), 51);
    const loser = (await read('one')).status === 'pending' ? 'one' : 'two';
    assert.equal((await service().reviewMember(loser, { action: 'approve' })).memberNumber, 51);
  });

  test('custom zero survives suspension and restoration, rejects collisions, and is recorded in audits', async () => {
    await insertProfiles([profile('zero'), profile('collision'), profile('automatic')]);
    const before = await nextNumber();
    assert.equal((await service().reviewMember('zero', { action: 'approve', memberNumber: 0 })).memberNumber, 0);
    assert.equal(await nextNumber(), before);
    await assert.rejects(service().reviewMember('collision', { action: 'approve', memberNumber: 0 }), isStatus(409));
    assert.equal((await read('collision')).status, 'pending');
    assert.equal(await nextNumber(), before);
    await service().reviewMember('zero', { action: 'suspend' });
    assert.equal((await service().reviewMember('zero', { action: 'approve' })).memberNumber, 0);
    assert.equal((await service().reviewMember('zero', { action: 'set-number', memberNumber: 0 })).memberNumber, 0);
    assert.equal(await nextNumber(), before);
    const audits = await db.select().from(schema.memberAuditLogs).where(eq(schema.memberAuditLogs.targetId, 'zero'));
    assert.equal(audits.length, 4);
    assert.ok(audits.every(({ details }) => (details.after as { memberNumber: number }).memberNumber === 0));
    assert.equal((await service().reviewMember('automatic', { action: 'approve' })).memberNumber, before);
  });

  test('renumbering to zero preserves the automatic high water and remains admin-only', async () => {
    await insertProfiles([profile('high'), profile('later')]);
    await service().reviewMember('high', { action: 'approve', memberNumber: 100 });
    await assert.rejects(service('lead').reviewMember('high', { action: 'set-number', memberNumber: 0 }), isStatus(403));
    await assert.rejects(service('lead').reviewMember('later', { action: 'approve', memberNumber: 0 }), isStatus(403));
    assert.equal((await service().reviewMember('high', { action: 'set-number', memberNumber: 0 })).memberNumber, 0);
    assert.equal(await nextNumber(), 101);
    assert.equal((await service().reviewMember('later', { action: 'approve' })).memberNumber, 101);
    await assert.rejects(service().reviewMember('later', { action: 'set-number', memberNumber: 0 }), isStatus(409));
    assert.equal((await read('later')).memberNumber, 101);
  });

  test('a zero-numbered founding admin leaves the first automatic member number at one', async () => {
    await clearDatabase();
    await insertProfiles([
      profile('admin', { role: 'admin', status: 'approved', memberNumber: 0, approvedAt: now }),
      profile('first-auto'),
    ]);
    assert.equal(await nextNumber(), 1);
    assert.equal((await service().reviewMember('first-auto', { action: 'approve' })).memberNumber, 1);
    const directory = await createMemberDirectory({
      getAuthContext: async () => identity('admin'), loadMembers: async () => loadDirectoryRecords(db),
    })();
    assert.equal(directory.status, 'member');
    if (directory.status === 'member') {
      assert.deepEqual(directory.members.map(({ memberNumber }) => memberNumber), [0, 1]);
    }
  });

  test('manual renumbering advances the sequence and automatic numbers never move backward', async () => {
    await insertProfiles([profile('one'), profile('two'), profile('three')]);
    assert.equal((await service().reviewMember('one', { action: 'approve', memberNumber: 100 })).memberNumber, 100);
    assert.equal((await service().reviewMember('two', { action: 'approve' })).memberNumber, 101);
    await service().reviewMember('one', { action: 'set-number', memberNumber: 5 });
    assert.equal((await service().reviewMember('three', { action: 'approve' })).memberNumber, 102);
    await assert.rejects(service().reviewMember('one', { action: 'set-number', memberNumber: 2 }), isStatus(409));
    assert.equal((await read('one')).memberNumber, 5);
  });

  test('approval enforces submitted, complete, verified applications; restoration preserves history', async () => {
    await insertProfiles([
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
    await insertProfiles([profile('applicant'), profile('staff', { role: 'instance-lead' })]);
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
    await insertProfiles(profile('applicant'));
    let pending: Promise<unknown> | undefined;
    await withMemberMutationLock(db, async (transaction) => {
      pending = service('lead').reviewMember('applicant', { action: 'approve' });
      // Attach a handler immediately so rejection is observed even on very fast hosts.
      void pending.catch(() => {});
      const lead = await findMemberRecordByTekidId(transaction, 'lead');
      await transaction.update(schema.memberships).set({ role: 'member' }).where(eq(schema.memberships.id, lead!.membershipId));
    });
    await assert.rejects(pending!, isStatus(403));
    assert.equal((await read('applicant')).status, 'pending');
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 0);
  });

  test('admins can revoke suspended staff roles without restoring access', async () => {
    await insertProfiles(profile('suspended-staff', {
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
    await insertProfiles(profile('admin-two', { status: 'approved', role: 'admin', memberNumber: 3, approvedAt: now }));
    const results = await Promise.allSettled([
      service().reviewMember('admin-two', { action: 'set-role', role: 'member' }),
      service('admin-two').reviewMember('admin', { action: 'set-role', role: 'member' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(isStatus(403)(rejected.reason));
    const admins = (await selectMemberRecords(db)).filter((member) => member.status === 'approved' && member.role === 'admin');
    assert.equal(admins.length, 1);
  });

  test('status filters paginate, protect application details, and reject forged actions', async () => {
    await insertProfiles(Array.from({ length: 23 }, (_, index) => profile(`pending-${index}`)));
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
      { action: 'approve', role: 'admin' }, { action: 'approve', memberNumber: -1 },
      { action: 'approve', memberNumber: maximumMemberNumber + 1 },
      { action: 'approve', memberNumber: '3' }, { action: 'delete' },
    ]) await assert.rejects(service().reviewMember('pending-0', mutation), isStatus(400));
  });

  test('draft and pending identities use local UUID relations without consuming member numbers', async () => {
    const before = await nextNumber();
    await insertProfiles([profile('unapproved-draft', { status: 'draft' }), profile('unapproved-pending')]);
    const draft = await read('unapproved-draft');
    assert.match(draft.userId, /^[0-9a-f-]{36}$/);
    assert.match(draft.membershipId, /^[0-9a-f-]{36}$/);
    assert.notEqual(draft.userId, draft.tekidUserId);
    assert.notEqual(draft.userId, draft.membershipId);
    assert.equal(draft.memberNumber, null);
    assert.equal((await read('unapproved-pending')).memberNumber, null);
    assert.equal(await nextNumber(), before);
    const listed = await service().listMembers(1, 'draft');
    assert.equal(listed.members[0]!.id, 'unapproved-draft');
    assert.equal('userId' in listed.members[0]!, false);
    assert.equal('membershipId' in listed.members[0]!, false);
  });

  test('authorization uses the user membership even when its profile is not yet present', async () => {
    const admin = await read('admin');
    await db.delete(schema.profiles).where(eq(schema.profiles.userId, admin.userId));
    assert.equal(await findMemberRecordByTekidId(db, 'admin'), null);
    assert.deepEqual(await findMemberAccessByTekidId(db, 'admin'), { role: 'admin', status: 'approved' });
    await insertProfiles(profile('new-applicant'));
    assert.equal((await service().reviewMember('new-applicant', { action: 'approve' })).status, 'approved');
  });

  test('an approved viewer without a profile can read the directory but is not listed', async () => {
    const admin = await read('admin');
    await db.delete(schema.profiles).where(eq(schema.profiles.userId, admin.userId));
    const directory = createMemberDirectory({
      getAuthContext: async () => identity('admin'),
      loadMembers: async () => loadDirectoryRecords(db),
    });
    const result = await directory();
    assert.equal(result.status, 'member');
    if (result.status !== 'member') return;
    assert.equal(result.viewerId, 'admin');
    assert.deepEqual(result.members.map((member) => member.id), ['lead']);
    assert.equal('userId' in result.members[0]!, false);
    await db.update(schema.memberships).set({ status: 'suspended' }).where(eq(schema.memberships.id, admin.membershipId));
    assert.deepEqual(await directory(), { status: 'not-member' });
  });

  test('staff without profiles remain visible and revocable without inventing profile rows', async () => {
    await insertProfiles(profile('missing-profile-admin', { role: 'admin', status: 'approved', memberNumber: 3, approvedAt: now }));
    const missing = await read('missing-profile-admin');
    await db.delete(schema.profiles).where(eq(schema.profiles.userId, missing.userId));
    const listed = (await service().listMembers()).members.find((member) => member.id === 'missing-profile-admin');
    assert.ok(listed);
    assert.equal(listed.name, null);
    assert.equal(listed.role, 'admin');
    assert.equal(listed.fields.name, '');
    assert.deepEqual(listed.fields.categories, []);
    await assert.rejects(service('lead').reviewMember('missing-profile-admin', { action: 'suspend' }), isStatus(403));
    assert.equal((await service().reviewMember('missing-profile-admin', { action: 'suspend' })).status, 'suspended');
    assert.equal((await service().reviewMember('missing-profile-admin', { action: 'set-role', role: 'member' })).role, 'member');
    await assert.rejects(service('missing-profile-admin').listMembers(), isStatus(403));
    assert.equal(await findMemberRecordByTekidId(db, 'missing-profile-admin'), null);
    assert.deepEqual(await db.select().from(schema.profiles).where(eq(schema.profiles.userId, missing.userId)), []);
  });

  test('failed automatic and custom reservations leave sequence gaps without membership or audit changes', async () => {
    const beforeProfiles = await selectMemberRecords(db);
    const first = await nextNumber();
    await assert.rejects(withMemberMutationLock(db, async (transaction) => {
      assert.equal(await reserveMemberNumber(transaction), first);
      throw new Error('Injected failure after nextval');
    }), /Injected failure/);
    assert.equal(await nextNumber(), first + 1);
    await assert.rejects(withMemberMutationLock(db, async (transaction) => {
      assert.equal(await reserveMemberNumber(transaction, 50), 50);
      throw new Error('Injected failure after setval');
    }), /Injected failure/);
    assert.equal(await nextNumber(), 51);
    assert.deepEqual(await selectMemberRecords(db), beforeProfiles);
    assert.equal((await db.select().from(schema.memberAuditLogs)).length, 0);
    await insertProfiles(profile('after-gap'));
    assert.equal((await service().reviewMember('after-gap', { action: 'approve' })).memberNumber, 51);
  });

  test('renumbering to the current number is idempotent and low custom numbers never reduce high water', async () => {
    await insertProfiles([profile('high'), profile('low'), profile('later')]);
    assert.equal((await service().reviewMember('high', { action: 'approve', memberNumber: 100 })).memberNumber, 100);
    assert.equal((await service().reviewMember('high', { action: 'set-number', memberNumber: 100 })).memberNumber, 100);
    assert.equal(await nextNumber(), 101);
    assert.equal((await service().reviewMember('low', { action: 'approve', memberNumber: 5 })).memberNumber, 5);
    assert.equal(await nextNumber(), 101);
    assert.equal((await service().reviewMember('later', { action: 'approve' })).memberNumber, 101);
  });

  test('exhausted sequence does not overflow or partially approve a member', async () => {
    await insertProfiles([profile('last'), profile('next')]);
    await service().reviewMember('last', { action: 'approve', memberNumber: maximumMemberNumber });
    await assert.rejects(service().reviewMember('next', { action: 'approve' }), isStatus(409));
    assert.equal((await read('next')).status, 'pending');
    assert.equal(await nextNumber(), 2_147_483_647);
  });
});
