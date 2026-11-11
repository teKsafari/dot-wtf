import './test-env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../lib/schema';
import {
  ApplicationError, createApplicationService, createDatabaseApplicationStore,
} from '../lib/applications';
import { emptyProfileFields, type ProfileFields } from '../lib/member-profile-fields';
import { createRateLimiter } from '../lib/rate-limit';
import { TekidAdminError, type TekidAdminClient } from '../lib/tekid/admin';
import type { UploadStore } from '../lib/uploads';

// Explicit opt-in only: these tests reset a disposable database, never app DATABASE_URL.
const testUrl = process.env.APPLICATION_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/dot_wtf_[a-z_]+_test$/.test(parsed.pathname)
    || parsed.search || parsed.hash) {
    throw new Error('APPLICATION_TEST_DATABASE_URL must name a disposable local dot_wtf_*_test database without query parameters.');
  }
}

const now = new Date('2026-11-11T12:00:00.000Z');
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function completeFields(): ProfileFields {
  return {
    ...emptyProfileFields,
    name: 'Ada Lovelace',
    institution: 'Analytical Engine Lab, London',
    whatsapp: '+1 555 000 0000',
    categories: ['Software / Coding'],
    wtfIdea: 'A machine that writes its own tables.',
    currentProject: 'A difference engine simulator.',
    youtubeLink: 'https://example.org/video',
    portfolio: 'https://ada.example.org/',
  };
}

describe('public application Postgres integration', { skip: !testUrl }, () => {
  const client = postgres(testUrl!, { max: 6, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const store = createDatabaseApplicationStore(db);
  const files = new Map<string, Uint8Array>();
  const uploads: UploadStore = {
    async save(bytes) {
      const key = `${String(files.size).padStart(32, '0')}.png`;
      files.set(key, bytes);
      return key;
    },
    async read(key) {
      const bytes = files.get(key);
      return bytes ? { contentType: 'image/png', bytes } : null;
    },
    async delete(key) { files.delete(key); },
  };

  function tekidClient(overrides: Partial<TekidAdminClient> = {}): TekidAdminClient {
    return {
      async createUser() { created.push('tekid-1'); return { id: 'tekid-1', username: 'ada', email: 'ada@example.org' }; },
      async deleteUser(id) { deleted.push(id); },
      async findGroupByName() { return { id: 'group-1', name: 'members' }; },
      async createGroup(name) { return { id: 'group-1', name }; },
      async setUserGroups() {},
      async createOneTimeAccessToken() { return 'abcdefghijkl'; },
      signInLink(token) { return `https://auth.mules.wtf/lc/${token}`; },
      ...overrides,
    };
  }
  const created: string[] = [];
  const deleted: string[] = [];

  function service(overrides: Partial<TekidAdminClient> = {}) {
    return createApplicationService({
      store, uploads,
      tekid: () => tekidClient(overrides),
      memberGroup: 'members', linkTtl: '12h', maximumUploadBytes: 5_000_000,
      photoUrl: (key) => `https://mules.wtf/api/uploads/${key}`,
      photoKey: (url) => url.split('/').pop() ?? null,
      limiter: createRateLimiter(50, 60_000),
      attemptLimiter: createRateLimiter(500, 60_000),
      now: () => now,
    });
  }

  async function submit(email = 'ada@example.org') {
    return service().submit({
      email, fields: completeFields(),
      photo: new File([png], 'ada.png', { type: 'image/png' }),
      honeypot: '', clientAddress: '198.51.100.7',
    });
  }

  before(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });
  beforeEach(async () => {
    await db.execute(sql`truncate table action_logs, member_audit_logs, memberships, profiles, users restart identity cascade`);
    await db.execute(sql`select setval('member_number_seq', 1, false)`);
    files.clear();
    created.length = 0;
    deleted.length = 0;
  });
  after(async () => { await client.end({ timeout: 5 }); });

  test('a submitted application is pending in the database with no member number', async () => {
    const view = await submit();
    const [row] = await db.execute<{ status: string; member_number: number | null; submitted_at: Date | null; tekid_user_id: string | null }>(
      sql`select m.status, m.member_number, m.submitted_at, u.tekid_user_id
          from memberships m join users u on u.id = m.user_id`
    );
    assert.equal(row!.status, 'pending');
    assert.equal(row!.member_number, null);
    assert.equal(row!.tekid_user_id, null);
    assert.ok(row!.submitted_at);
    assert.equal(view.memberNumber, null);
    const pending = (await service().listQueue()).pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.userId, view.userId);
  });

  test('approval commits the identity, the number, the timestamps and the log together', async () => {
    const application = await submit();
    const { application: approved, link } = await service().approve(application.userId, 'admin-sub');

    assert.equal(approved.status, 'approved');
    assert.equal(approved.memberNumber, 1);
    assert.match(link.url, /^https:\/\/auth\.mules\.wtf\/lc\//);

    const [row] = await db.execute<{ status: string; member_number: number; approved_at: Date; tekid_user_id: string }>(
      sql`select m.status, m.member_number, m.approved_at, u.tekid_user_id
          from memberships m join users u on u.id = m.user_id`
    );
    assert.equal(row!.status, 'approved');
    assert.equal(row!.member_number, 1);
    assert.ok(row!.approved_at);
    assert.ok(row!.tekid_user_id);

    const logs = await db.execute<{ action: string }>(sql`select action from action_logs`);
    assert.deepEqual(logs.map((entry) => entry.action), ['approved']);
    const audits = await db.execute<{ action: string }>(sql`select action from member_audit_logs`);
    assert.deepEqual(audits.map((entry) => entry.action), ['member.approve-application']);
  });

  test('a tekID failure after the account exists rolls the row back and removes the account', async () => {
    const application = await submit();
    await assert.rejects(
      service({
        async createUser() { return { id: 'tekid-orphan', username: 'ada', email: 'ada@example.org' }; },
        async createOneTimeAccessToken() { throw new TekidAdminError(500, null, 'tekID rejected the request (500).'); },
      }).approve(application.userId, 'admin-sub'),
      (error: unknown) => error instanceof ApplicationError && error.status === 503
    );

    const [row] = await db.execute<{ status: string; member_number: number | null; approved_at: Date | null; tekid_user_id: string | null }>(
      sql`select m.status, m.member_number, m.approved_at, u.tekid_user_id
          from memberships m join users u on u.id = m.user_id`
    );
    assert.equal(row!.status, 'pending');
    assert.equal(row!.member_number, null);
    assert.equal(row!.approved_at, null);
    assert.equal(row!.tekid_user_id, null);
    assert.equal((await db.execute(sql`select 1 from action_logs`)).length, 0);
    assert.deepEqual(deleted, ['tekid-orphan']);
    // Still reviewable, which is the point of refusing a half approval.
    assert.equal(((await service().listQueue()).pending).length, 1);
  });

  test('the approved row satisfies the constraint that an approved member is numbered', async () => {
    const application = await submit();
    await service().approve(application.userId, 'admin-sub');
    await assert.rejects(
      db.execute(sql`update memberships set member_number = null`),
      (error: unknown) => String((error as { cause?: unknown }).cause).includes('memberships_approval_check')
    );
  });

  test('a second application from the same address is refused', async () => {
    await submit();
    await assert.rejects(submit(), (error: unknown) => error instanceof ApplicationError && error.status === 409);
    const rows = await db.execute(sql`select 1 from users`);
    assert.equal(rows.length, 1);
  });
});
