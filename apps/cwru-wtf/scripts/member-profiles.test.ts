import './test-env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../lib/schema';
import { memberAuditLogs, memberships, profiles as profileRecords, submissions, users } from '../lib/schema';
import { createProfileStore, importedProfileFields, ProfileSubmissionError } from '../lib/member-profiles';
import { emptyProfileFields, profileFieldsSchema, profileLimits, type ProfileFields } from '../lib/member-profile-fields';
import type { AuthSession } from '../lib/tekid/types';

// Explicit opt-in: this suite resets a disposable database, never app DATABASE_URL.
const testUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/dot_wtf_[a-z_]+_test$/.test(parsed.pathname)
    || parsed.search || parsed.hash) {
    throw new Error('PROFILE_TEST_DATABASE_URL must name a disposable local dot_wtf_*_test database without query parameters.');
  }
}

const claims = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  sub: 'ada', name: 'Ada from tekID', username: null, email: 'Ada@Example.org',
  email_verified: true, picture: 'https://images.example.org/ada.png', ...overrides,
});
const completeFields = (overrides: Partial<ProfileFields> = {}): ProfileFields => ({
  ...emptyProfileFields, name: 'Ada Lovelace', institution: 'CWRU, Cleveland', whatsapp: '+1 555 000 0000',
  categories: ['Research'], wtfIdea: 'A loom that writes poetry', currentProject: 'Analytical engine notes',
  youtubeLink: 'https://youtu.be/abc', portfolio: 'https://ada.dev/', ...overrides,
});
const legacyApplication = {
  name: 'Ada from the old application', email: 'ada@example.org',
  categories: JSON.stringify(['Research', 'Other']), otherCategory: 'Poetry machines', whatsapp: '+1 555 111 1111',
  wtfIdea: '  A loom that writes poetry  ', currentProject: 'An old analytical engine',
  youtubeLink: 'https://www.youtube.com/watch?v=abc', isApproved: true,
};
describe('local profile persistence', { skip: !testUrl, concurrency: false }, () => {
  const client = postgres(testUrl!, { max: 5, onnotice: () => {} });
  const database = drizzle(client, { schema });
  const profiles = createProfileStore(database);
  async function readProfile(userId = 'ada') {
    const [row] = await database.select({ user: users, profile: profileRecords, membership: memberships })
      .from(users).innerJoin(profileRecords, eq(profileRecords.userId, users.id))
      .innerJoin(memberships, eq(memberships.userId, users.id)).where(eq(users.tekidUserId, userId));
    assert.ok(row, `Expected a profile for ${userId}`);
    return { ...row.user, ...row.profile, ...row.membership, userId: row.user.id, membershipId: row.membership.id };
  }
  async function insertProfile(
    identity: typeof users.$inferInsert,
    profile: Omit<typeof profileRecords.$inferInsert, 'userId'>,
    membership: Omit<typeof memberships.$inferInsert, 'userId'>,
  ) {
    return database.transaction(async (tx) => {
      const [user] = await tx.insert(users).values(identity).returning();
      await tx.insert(profileRecords).values({ ...profile, userId: user.id });
      await tx.insert(memberships).values({ ...membership, userId: user.id });
    });
  }
  async function updateMembership(values: Partial<typeof memberships.$inferInsert>, tekidUserId = 'ada') {
    const { userId } = await readProfile(tekidUserId);
    await database.update(memberships).set(values).where(eq(memberships.userId, userId));
  }
  const audits = () => database.select().from(memberAuditLogs).where(eq(memberAuditLogs.action, 'profile.submitted'));

  before(async () => {
    const [identity] = await client`SELECT current_database() AS name`;
    assert.equal(identity.name, new URL(testUrl!).pathname.slice(1));
    await migrate(database, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    // Supply a separate database per integration suite to avoid shared-table resets.
    await client`TRUNCATE TABLE users, profiles, memberships, member_audit_logs, action_logs, submissions RESTART IDENTITY`;
  });

  it('first sign-in creates only a draft even when identity claims advertise elevated roles', async () => {
    const [sequenceBefore] = await client`SELECT last_value::text, is_called FROM member_number_seq`;
    const identity = Object.assign(claims(), { roles: ['admin'], organization_roles: ['instance-lead'] });
    const view = await profiles.getProfile(identity);
    const row = await readProfile();
    assert.equal(view.status, 'draft');
    assert.equal(view.memberNumber, null);
    assert.equal(view.submittedAt, null);
    assert.equal(view.imported, false);
    assert.deepEqual(view.fields, { ...emptyProfileFields, name: identity.name });
    assert.equal(row.email, identity.email);
    assert.equal(row.emailVerified, true);
    assert.equal(row.picture, identity.picture);
    assert.equal(row.role, 'member');
    assert.equal(row.approvedAt, null);
    assert.match(row.userId, /^[0-9a-f-]{36}$/);
    assert.match(row.membershipId, /^[0-9a-f-]{36}$/);
    assert.notEqual(row.userId, row.membershipId);
    assert.notEqual(row.userId, identity.sub);
    const [sequenceAfter] = await client`SELECT last_value::text, is_called FROM member_number_seq`;
    assert.deepEqual(sequenceAfter, sequenceBefore);
    assert.equal((await audits()).length, 0);
  });

  it('separate authenticated subjects sharing an email keep distinct local profiles and memberships', async () => {
    await profiles.saveProfile(claims(), completeFields({ name: 'Ada', bio: 'First profile' }));
    await profiles.saveProfile(claims({ sub: 'another-ada' }), completeFields({ name: 'Another Ada', bio: 'Second profile' }), 'submit');
    const first = await readProfile();
    const second = await readProfile('another-ada');
    assert.notEqual(first.userId, second.userId);
    assert.notEqual(first.membershipId, second.membershipId);
    assert.equal(first.bio, 'First profile');
    assert.equal(first.status, 'draft');
    assert.equal(second.bio, 'Second profile');
    assert.equal(second.status, 'pending');
    assert.equal((await audits())[0].targetId, 'another-ada');
  });

  it('identity refresh preserves every local status, role, member number, edited name, and review decision', async () => {
    const approvedAt = new Date('2026-09-01T12:00:00Z');
    const submittedAt = new Date('2026-08-30T12:00:00Z');
    for (const [index, status] of (['draft', 'pending', 'approved', 'rejected', 'suspended'] as const).entries()) {
      const id = `member-${status}`;
      await insertProfile(
        { tekidUserId: id, email: 'before@example.org', emailVerified: true },
        { name: 'My local name', bio: 'My local bio', picture: 'https://images.example.org/old.png' },
        { status, role: 'admin', memberNumber: index + 1, approvedAt, submittedAt, reviewedBy: 'reviewer', reviewedAt: approvedAt },
      );
      const before = await readProfile(id);
      const view = await profiles.getProfile(claims({ sub: id, name: 'Different identity name', email: 'new@example.org', email_verified: false }));
      const row = await readProfile(id);
      assert.equal(view.status, status);
      assert.equal(view.memberNumber, index + 1);
      assert.equal(view.fields.name, 'My local name');
      assert.equal(view.fields.bio, 'My local bio');
      assert.equal(row.role, 'admin');
      assert.equal(row.email, 'new@example.org');
      assert.equal(row.emailVerified, false);
      assert.equal(row.picture, claims().picture);
      assert.deepEqual(row.approvedAt, approvedAt);
      assert.deepEqual(row.submittedAt, submittedAt);
      assert.equal(row.reviewedBy, 'reviewer');
      assert.deepEqual(row.reviewedAt, approvedAt);
      assert.equal(row.userId, before.userId);
      assert.equal(row.membershipId, before.membershipId);
      assert.deepEqual(row.updatedAt, before.updatedAt);
    }
  });

  it('unsafe identity pictures are never persisted', async () => {
    for (const [index, picture] of ['javascript:alert(1)', 'http://images.example.org/a.png', 'https://user:pw@images.example.org/a.png'].entries()) {
      await profiles.getProfile(claims({ sub: `picture-${index}`, picture }));
      assert.equal((await readProfile(`picture-${index}`)).picture, null);
    }
  });

  it('verified case-insensitive email imports the latest legacy application once without granting membership', async () => {
    const createdAt = new Date('2026-01-01T12:00:00Z');
    await database.insert(submissions).values([
      { ...legacyApplication, currentProject: 'Older response', createdAt },
      { ...legacyApplication, createdAt },
      { ...legacyApplication, email: 'someone-else@example.org', currentProject: 'Another person', createdAt: new Date('2026-09-01') },
    ]);
    const first = await profiles.getProfile(claims());
    assert.equal(first.imported, true);
    assert.equal(first.status, 'draft');
    assert.equal((await readProfile()).role, 'member');
    assert.equal(first.memberNumber, null);
    assert.deepEqual(first.fields, importedProfileFields(legacyApplication));
    const edited = completeFields({ name: 'My chosen name', bio: 'I edited this', currentProject: 'A newer local project' });
    await profiles.saveProfile(claims(), edited);
    await database.insert(submissions).values({ ...legacyApplication, currentProject: 'Later legacy submission' });
    const again = await profiles.getProfile(claims());
    assert.equal(again.imported, false);
    assert.deepEqual(again.fields, edited);
  });

  it('unverified email cannot read matching legacy application answers', async () => {
    await database.insert(submissions).values(legacyApplication);
    const view = await profiles.getProfile(claims({ email_verified: false }));
    assert.equal(view.imported, false);
    assert.deepEqual(view.fields, { ...emptyProfileFields, name: claims().name });
    assert.equal((await readProfile()).emailVerified, false);
    assert.equal(view.status, 'draft');
  });

  it('verification after an unverified first visit imports only missing legacy answers', async () => {
    await database.insert(submissions).values(legacyApplication);
    const unverified = claims({ email_verified: false });
    await profiles.getProfile(unverified);
    await profiles.saveProfile(unverified, {
      ...emptyProfileFields, name: 'My edited name', bio: 'My bio', currentProject: 'My saved project',
      categories: ['Architecture'], github: 'https://github.com/ada', institution: 'My institution',
    });
    const view = await profiles.getProfile(claims());
    assert.equal(view.imported, true);
    assert.equal(view.fields.name, 'My edited name');
    assert.equal(view.fields.bio, 'My bio');
    assert.equal(view.fields.currentProject, 'My saved project');
    assert.equal(view.fields.institution, 'My institution');
    assert.equal(view.fields.github, 'https://github.com/ada');
    assert.deepEqual(view.fields.categories, ['Architecture']);
    assert.equal(view.fields.wtfIdea, legacyApplication.wtfIdea.trim());
    assert.equal(view.fields.youtubeLink, legacyApplication.youtubeLink);
    assert.equal(view.fields.whatsapp, legacyApplication.whatsapp);
    assert.equal(view.status, 'draft');
    assert.equal(view.memberNumber, null);
  });

  it('an intentionally cleared draft name stays blank when identity details refresh', async () => {
    await profiles.saveProfile(claims(), completeFields());
    await profiles.saveProfile(claims(), completeFields({ name: '' }));
    const view = await profiles.getProfile(claims({ name: 'A changed tekID name' }));
    assert.equal(view.fields.name, '');
    assert.equal((await readProfile()).name, '');
  });

  it('verification changes never repeat an import or restore deliberately erased answers', async () => {
    await database.insert(submissions).values(legacyApplication);
    assert.equal((await profiles.getProfile(claims())).imported, true);
    await profiles.saveProfile(claims(), emptyProfileFields);
    await profiles.getProfile(claims({ email_verified: false }));
    const view = await profiles.getProfile(claims());
    assert.equal(view.imported, false);
    assert.deepEqual(view.fields, emptyProfileFields);
    const imports = await database.select().from(memberAuditLogs).where(eq(memberAuditLogs.action, 'profile.legacy-imported'));
    assert.equal(imports.length, 1);
    assert.deepEqual(imports[0].details, { applicationFound: true });
  });

  it('a verified import attempt with no match is not repeated after a later verification change', async () => {
    await profiles.getProfile(claims());
    await database.insert(submissions).values(legacyApplication);
    await profiles.getProfile(claims({ email_verified: false }));
    const view = await profiles.getProfile(claims());
    assert.equal(view.imported, false);
    assert.deepEqual(view.fields, { ...emptyProfileFields, name: claims().name });
    const imports = await database.select().from(memberAuditLogs).where(eq(memberAuditLogs.action, 'profile.legacy-imported'));
    assert.equal(imports.length, 1);
    assert.deepEqual(imports[0].details, { applicationFound: false });
  });

  it('a verified identity without a matching application has no imported answers', async () => {
    await database.insert(submissions).values({ ...legacyApplication, email: 'another@example.org' });
    const view = await profiles.getProfile(claims());
    assert.equal(view.imported, false);
    assert.deepEqual(view.fields, { ...emptyProfileFields, name: claims().name });
  });

  it('pre-migration profiles retain every stored answer and access decision while legacy fields are hydrated', async () => {
    await database.insert(submissions).values(legacyApplication);
    const approvedAt = new Date('2026-08-01T12:00:00Z');
    await insertProfile(
      { tekidUserId: 'ada', email: '' },
      { name: 'Already edited', bio: 'Local bio', wtfIdea: '', currentProject: 'Local project', youtubeLink: 'https://youtu.be/local',
        socialLinks: { github: 'https://github.com/ada', portfolio: 'https://local.example.org/' } },
      { status: 'suspended', role: 'instance-lead', memberNumber: 17, approvedAt },
    );
    const view = await profiles.getProfile(claims());
    assert.equal(view.fields.name, 'Already edited');
    assert.equal(view.fields.bio, 'Local bio');
    assert.equal(view.fields.wtfIdea, '');
    assert.equal(view.fields.currentProject, 'Local project');
    assert.equal(view.fields.youtubeLink, 'https://youtu.be/local');
    assert.equal(view.fields.github, 'https://github.com/ada');
    assert.equal(view.fields.portfolio, 'https://local.example.org/');
    assert.deepEqual(view.fields.categories, ['Research', 'Other']);
    assert.equal(view.fields.whatsapp, legacyApplication.whatsapp);
    const row = await readProfile();
    assert.equal(row.status, 'suspended');
    assert.equal(row.role, 'instance-lead');
    assert.equal(row.memberNumber, 17);
    assert.deepEqual(row.approvedAt, approvedAt);
  });

  it('an incomplete draft saves without submitting or granting membership', async () => {
    const view = await profiles.saveProfile(claims(), { ...emptyProfileFields, bio: 'Still thinking', categories: ['Other'] });
    assert.equal(view.status, 'draft');
    assert.equal(view.submittedAt, null);
    assert.equal(view.memberNumber, null);
    assert.equal(view.fields.bio, 'Still thinking');
    assert.equal((await audits()).length, 0);
  });

  it('a complete verified application becomes pending with one audit, even if submitted again', async () => {
    const view = await profiles.saveProfile(claims(), completeFields(), 'submit');
    assert.equal(view.status, 'pending');
    assert.ok(view.submittedAt);
    assert.equal(view.memberNumber, null);
    assert.equal((await readProfile()).role, 'member');
    const [audit] = await audits();
    assert.deepEqual({ actor: audit.actorId, target: audit.targetId, details: audit.details }, {
      actor: 'ada', target: 'ada', details: { previousStatus: 'draft' },
    });
    const again = await profiles.saveProfile(claims(), completeFields({ bio: 'Updated during review' }), 'submit');
    assert.equal(again.status, 'pending');
    assert.equal(again.submittedAt, view.submittedAt);
    assert.equal((await audits()).length, 1);
  });

  it('unverified submission is rejected without creating a profile or audit', async () => {
    await assert.rejects(profiles.saveProfile(claims({ email_verified: false }), completeFields(), 'submit'), ProfileSubmissionError);
    assert.deepEqual(await database.select().from(users), []);
    assert.deepEqual(await database.select().from(profileRecords), []);
    assert.deepEqual(await database.select().from(memberships), []);
    assert.deepEqual(await audits(), []);
  });

  it('incomplete submission leaves a previously saved draft intact', async () => {
    const before = await profiles.saveProfile(claims(), completeFields({ bio: 'Saved draft' }));
    await assert.rejects(profiles.saveProfile(claims(), { ...emptyProfileFields, bio: 'Unsaved invalid submission' }, 'submit'));
    const after = await profiles.getProfile(claims());
    assert.deepEqual(after.fields, before.fields);
    assert.equal(after.status, 'draft');
    assert.equal((await audits()).length, 0);
  });

  it('suspended members can save fields but cannot submit or alter access', async () => {
    await profiles.saveProfile(claims(), completeFields());
    await updateMembership({ status: 'suspended', role: 'instance-lead', memberNumber: 24 });
    const before = await readProfile();
    await assert.rejects(profiles.saveProfile(claims({ email: 'new@example.org' }), completeFields({ bio: 'Should roll back' }), 'submit'), ProfileSubmissionError);
    assert.deepEqual(await readProfile(), before);
    const saved = await profiles.saveProfile(claims(), completeFields({ bio: 'An allowed edit' }));
    assert.equal(saved.status, 'suspended');
    assert.equal(saved.memberNumber, 24);
    assert.equal(saved.fields.bio, 'An allowed edit');
    assert.equal((await readProfile()).role, 'instance-lead');
    assert.equal((await audits()).length, 0);
  });

  it('approved edits retain approval, elevated role, review metadata, and member number', async () => {
    await profiles.saveProfile(claims(), completeFields(), 'submit');
    const approvedAt = new Date('2026-09-20T12:00:00Z');
    await updateMembership({ status: 'approved', role: 'admin', memberNumber: 42, approvedAt, reviewedAt: approvedAt, reviewedBy: 'another-admin' });
    const before = await readProfile();
    const membershipBefore = await database.select().from(memberships).where(eq(memberships.userId, before.userId));
    for (const intent of ['save', 'submit'] as const) {
      const view = await profiles.saveProfile(claims(), completeFields({ bio: `Edited with ${intent}`, github: '@ada' }), intent);
      const row = await readProfile();
      assert.equal(view.status, 'approved');
      assert.equal(view.memberNumber, 42);
      assert.equal(view.fields.github, 'https://github.com/ada');
      assert.equal(row.role, 'admin');
      assert.deepEqual(row.approvedAt, approvedAt);
      assert.deepEqual(row.submittedAt, before.submittedAt);
      assert.deepEqual(row.reviewedAt, approvedAt);
      assert.equal(row.reviewedBy, 'another-admin');
      assert.deepEqual(await database.select().from(memberships).where(eq(memberships.userId, before.userId)), membershipBefore);
    }
    assert.equal((await audits()).length, 1);
  });

  it('rejected members resubmit without choosing their identity, role, or number', async () => {
    await profiles.saveProfile(claims(), completeFields());
    await updateMembership({ status: 'rejected' });
    const forged = Object.assign(completeFields(), { status: 'approved', role: 'admin', memberNumber: 1, tekidUserId: 'another-user',
      userId: '00000000-0000-0000-0000-000000000001', membershipId: '00000000-0000-0000-0000-000000000002', email: 'someone-else@example.org' });
    const view = await profiles.saveProfile(claims(), forged, 'submit');
    const row = await readProfile();
    assert.equal(view.status, 'pending');
    assert.equal(row.role, 'member');
    assert.equal(row.memberNumber, null);
    assert.equal(row.email, claims().email);
    assert.equal(row.tekidUserId, claims().sub);
    assert.equal((await database.select().from(users)).length, 1);
    assert.equal((await database.select().from(profileRecords)).length, 1);
    assert.equal((await database.select().from(memberships)).length, 1);
    assert.deepEqual((await audits())[0].details, { previousStatus: 'rejected' });
  });

  it('concurrent first visits import once and concurrent submissions create one audit', async () => {
    await database.insert(submissions).values(legacyApplication);
    const views = await Promise.all([profiles.getProfile(claims()), profiles.getProfile(claims()), profiles.getProfile(claims())]);
    assert.equal(views.filter((view) => view.imported).length, 1);
    assert.equal((await database.select().from(users)).length, 1);
    assert.equal((await database.select().from(profileRecords)).length, 1);
    assert.equal((await database.select().from(memberships)).length, 1);
    const saved = await Promise.all([
      profiles.saveProfile(claims(), completeFields({ bio: 'One tab' }), 'submit'),
      profiles.saveProfile(claims(), completeFields({ bio: 'Another tab' }), 'submit'),
    ]);
    assert.ok(saved.every((view) => view.status === 'pending'));
    assert.equal((await audits()).length, 1);
  });

  it('imported answers are bounded and unsafe video links are discarded', () => {
    const imported = importedProfileFields({ ...legacyApplication, wtfIdea: 'x'.repeat(profileLimits.text + 50), youtubeLink: 'javascript:alert(1)' });
    assert.equal(imported.wtfIdea.length, profileLimits.text);
    assert.equal(imported.youtubeLink, '');
    assert.equal(profileFieldsSchema.safeParse(imported).success, true);
  });
});
