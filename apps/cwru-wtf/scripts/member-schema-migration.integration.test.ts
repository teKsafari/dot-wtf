import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import postgres from 'postgres';

// This suite recreates public ONLY in this explicitly named disposable database.
// It does not load .env or consult application DATABASE_URL.
const testUrl = process.env.SCHEMA_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.pathname !== '/dot_wtf_split_migration_test' || parsed.search || parsed.hash) {
    throw new Error('SCHEMA_TEST_DATABASE_URL must point to the disposable loopback dot_wtf_split_migration_test database without query or fragment.');
  }
}

const folder = fileURLToPath(new URL('../drizzle/', import.meta.url));
const splitFile = `${folder}0012_split_member_tables.sql`;
const journal = JSON.parse(readFileSync(`${folder}meta/_journal.json`, 'utf8')) as { entries: { idx: number; tag: string }[] };
const lock = "SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0))";

describe('member split migration and deployed-app compatibility', { skip: !testUrl, concurrency: false }, () => {
  const client = postgres(testUrl!, { max: 8, onnotice: () => {} });
  const migrateSplit = async () => {
    const script = await readFile(splitFile, 'utf8');
    await client.begin(async (tx) => {
      for (const statement of script.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.unsafe(statement);
      }
    });
  };
  const sequence = async () => (await client`SELECT last_value::text, is_called FROM member_number_seq`)[0]!;
  const seedLegacy = async () => {
    await client`INSERT INTO member_profiles (tekid_user_id, name, email, email_verified,
      picture, categories, institution, other_category, whatsapp, bio, wtf_idea,
      current_project, youtube_link, social_links, status, role, member_number,
      submitted_at, approved_at, reviewed_at, reviewed_by, created_at, updated_at)
      VALUES ('old-admin', 'Chosen name', 'admin@example.org', true, 'https://example.org/photo.png',
        '["Research", "Other"]', 'School + city', 'Robots', '+15555550123', 'Saved bio',
        'Saved idea', 'Saved project', 'https://example.org/video', '{"portfolio":"https://example.org"}',
        'approved', 'admin', 17, '2025-01-01', '2025-02-01', '2025-03-01', 'operator:bootstrap', '2024-01-01', '2025-03-01'),
      ('old-suspended', '', '', false, null, '[]', '', '', '', '', '', '', '', '{}',
        'suspended', 'instance-lead', 2, null, '2024-02-01', null, null, '2024-01-01', '2024-02-01'),
      ('old-draft', '', '', false, null, '[]', '', '', '', '', '', '', '', '{}',
        'draft', 'member', null, null, null, null, null, '2025-01-01', '2025-01-01')`;
    await client`UPDATE member_number_counter SET next_number = 120 WHERE id = 1`;
    await client`INSERT INTO member_audit_logs (actor_id, target_id, action, details)
      VALUES ('operator:logto-import', 'old-admin', 'member.import-logto', '{"outcome":"import"}')`;
  };

  before(async () => {
    assert.equal((await client`SELECT current_database() AS name`)[0]!.name, 'dot_wtf_split_migration_test');
  });
  after(async () => { await client.end(); });
  beforeEach(async () => {
    await client`DROP SCHEMA public CASCADE`;
    await client`CREATE SCHEMA public`;
    await client.begin(async (tx) => {
      for (const entry of journal.entries.filter(({ idx }) => idx <= 11)) {
        const script = await readFile(`${folder}${entry.tag}.sql`, 'utf8');
        for (const statement of script.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.unsafe(statement);
        }
      }
    });
  });

  test('backfill preserves every legacy field, all audit markers, local IDs, and counter high water', async () => {
    await seedLegacy();
    const original = await client`SELECT to_jsonb(p) AS row FROM member_profiles p ORDER BY tekid_user_id`;
    const audits = await client`SELECT * FROM member_audit_logs ORDER BY id`;
    await migrateSplit();
    assert.deepEqual(await client`SELECT to_jsonb(p) AS row FROM member_profiles p ORDER BY tekid_user_id`, original);
    assert.deepEqual(await client`SELECT * FROM member_audit_logs ORDER BY id`, audits);
    const ids = await client`SELECT u.id::text AS user_id, p.user_id::text AS profile_user_id,
      m.id::text AS membership_id, m.user_id::text AS membership_user_id FROM users u
      JOIN profiles p ON p.user_id = u.id JOIN memberships m ON m.user_id = u.id`;
    assert.equal(ids.length, 3);
    for (const row of ids) {
      assert.match(row.user_id, /^[0-9a-f-]{36}$/);
      assert.match(row.membership_id, /^[0-9a-f-]{36}$/);
      assert.equal(row.user_id, row.profile_user_id);
      assert.equal(row.user_id, row.membership_user_id);
      assert.notEqual(row.user_id, row.membership_id);
    }
    assert.deepEqual(await sequence(), { last_value: '120', is_called: false });
    assert.equal((await client`SELECT relkind FROM pg_class WHERE oid = 'member_profiles'::regclass`)[0]!.relkind, 'v');
  });

  test('legacy insert, row locks, updates, returning, and delete operate on canonical tables', async () => {
    await migrateSplit();
    const [draft] = await client`INSERT INTO member_profiles (tekid_user_id) VALUES ('legacy-new') RETURNING *`;
    assert.equal(draft!.status, 'draft');
    assert.equal(draft!.member_number, null);
    assert.equal(draft!.name, '');
    assert.deepEqual(draft!.categories, []);
    assert.deepEqual(await sequence(), { last_value: '1', is_called: false });
    const [ids] = await client`SELECT u.id, m.id AS membership_id FROM users u JOIN memberships m ON m.user_id = u.id WHERE tekid_user_id = 'legacy-new'`;
    await client.begin(async (tx) => {
      await tx.unsafe(lock);
      await tx`SELECT * FROM member_profiles WHERE tekid_user_id = 'legacy-new' FOR UPDATE`;
      const [updated] = await tx`UPDATE member_profiles SET name = 'Edited', email = 'new@example.org',
        email_verified = true, categories = '["Research"]', institution = 'School', status = 'pending',
        submitted_at = now(), updated_at = now() WHERE tekid_user_id = 'legacy-new' RETURNING *`;
      assert.equal(updated!.name, 'Edited');
      assert.equal(updated!.status, 'pending');
    });
    const [canonical] = await client`SELECT u.id, m.id AS membership_id, p.name, u.email, m.status FROM users u
      JOIN profiles p ON p.user_id=u.id JOIN memberships m ON m.user_id=u.id WHERE tekid_user_id='legacy-new'`;
    assert.equal(canonical!.id, ids!.id);
    assert.equal(canonical!.membership_id, ids!.membership_id);
    assert.equal(canonical!.name, 'Edited');
    assert.equal(canonical!.email, 'new@example.org');
    assert.equal(canonical!.status, 'pending');
    await client`DELETE FROM member_profiles WHERE tekid_user_id = 'legacy-new' RETURNING tekid_user_id`;
    assert.equal((await client`SELECT * FROM users`).length, 0);
    assert.equal((await client`SELECT * FROM profiles`).length, 0);
    assert.equal((await client`SELECT * FROM memberships`).length, 0);
  });

  test('legacy and canonical allocators share a monotonic high water during concurrent approvals', async () => {
    await seedLegacy();
    await migrateSplit();
    for (let i = 0; i < 12; i++) await client`INSERT INTO member_profiles (tekid_user_id, status) VALUES (${`candidate-${i}`}, 'pending')`;
    const numbers = await Promise.all(Array.from({ length: 12 }, (_, i) => client.begin(async (tx) => {
      await tx.unsafe(lock);
      let number: number;
      if (i % 2 === 0) {
        await tx`INSERT INTO member_number_counter (id, next_number) VALUES (1, 1) ON CONFLICT DO NOTHING`;
        const [counter] = await tx`SELECT * FROM member_number_counter WHERE id = 1 FOR UPDATE`;
        const [maximum] = await tx`SELECT max(member_number) AS number FROM member_profiles`;
        number = Math.max(counter!.next_number, (maximum!.number ?? 0) + 1);
        await tx`UPDATE member_number_counter SET next_number = ${number + 1} WHERE id = 1`;
        await tx`UPDATE member_profiles SET status = 'approved', member_number = ${number}, approved_at = now() WHERE tekid_user_id = ${`candidate-${i}`}`;
      } else {
        number = Number((await tx`SELECT nextval('member_number_seq') AS number`)[0]!.number);
        await tx`UPDATE memberships SET status = 'approved', member_number = ${number}, approved_at = now()
          WHERE user_id = (SELECT id FROM users WHERE tekid_user_id = ${`candidate-${i}`})`;
      }
      return number;
    })));
    assert.deepEqual(numbers.sort((a,b) => a-b), Array.from({ length: 12 }, (_, i) => 120+i));
    assert.equal((await client`SELECT next_number FROM member_number_counter WHERE id=1`)[0]!.next_number, 132);
    assert.equal(Number((await client`SELECT nextval('member_number_seq') AS n`)[0]!.n), 132);
    await client`UPDATE memberships SET member_number = 900 WHERE user_id = (SELECT id FROM users WHERE tekid_user_id='old-admin')`;
    await client`UPDATE member_profiles SET member_number = 3 WHERE tekid_user_id='old-admin'`;
    assert.equal(Number((await client`SELECT nextval('member_number_seq') AS n`)[0]!.n), 901);
  });

  test('ordinary identity/profile/membership reads and edits do not consume sequence values', async () => {
    await seedLegacy();
    await migrateSplit();
    const original = await sequence();
    await client`SELECT * FROM users JOIN profiles ON profiles.user_id=users.id JOIN memberships ON memberships.user_id=users.id`;
    await client`UPDATE profiles SET bio='New bio'`;
    await client`UPDATE users SET email_verified=false`;
    await client`UPDATE memberships SET status='suspended' WHERE status='approved'`;
    await client`UPDATE member_profiles SET name='New display name' WHERE tekid_user_id='old-admin'`;
    await client`INSERT INTO member_profiles (tekid_user_id) VALUES ('another-draft')`;
    assert.deepEqual(await sequence(), original);
  });

  test('legacy allocation skips sequence values consumed by a rolled-back new request', async () => {
    await seedLegacy();
    await migrateSplit();
    await assert.rejects(client.begin(async (tx) => {
      await tx.unsafe(lock);
      assert.equal(Number((await tx`SELECT nextval('member_number_seq') AS n`)[0]!.n), 120);
      throw new Error('failed new approval');
    }));
    assert.equal((await client`SELECT next_number FROM member_number_counter WHERE id=1`)[0]!.next_number, 120);
    await client.begin(async (tx) => {
      await tx.unsafe(lock);
      await tx`INSERT INTO member_number_counter (id,next_number) VALUES (1,1) ON CONFLICT DO NOTHING`;
      assert.equal((await tx`SELECT next_number FROM member_number_counter WHERE id=1 FOR UPDATE`)[0]!.next_number, 121);
    });
  });

  test('explicit non-owner application grants survive the table-to-view cutover', async () => {
    const role = `dot_wtf_split_app_${process.pid}`;
    await client.unsafe(`CREATE ROLE "${role}" NOLOGIN`);
    try {
      await client.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await client.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON member_profiles, member_number_counter TO "${role}"`);
      await migrateSplit();
      const functions = await client`SELECT prosecdef FROM pg_proc WHERE proname IN
        ('write_legacy_member_profile','advance_member_number_high_water','bridge_legacy_member_counter','bridge_numbered_membership')`;
      assert.equal(functions.length, 4);
      assert.ok(functions.every(({ prosecdef }) => prosecdef === false));
      await client.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE "${role}"`);
        await tx`INSERT INTO member_profiles (tekid_user_id) VALUES ('non-owner-app')`;
        await tx.unsafe(lock);
        await tx`SELECT * FROM member_profiles FOR UPDATE`;
        await tx`UPDATE member_profiles SET member_number=5, status='approved', approved_at=now() WHERE tekid_user_id='non-owner-app'`;
        assert.equal((await tx`SELECT p.name, m.member_number FROM users u JOIN profiles p ON p.user_id=u.id JOIN memberships m ON m.user_id=u.id`)[0]!.member_number, 5);
      });
    } finally {
      await client.unsafe(`DROP OWNED BY "${role}"`);
      await client.unsafe(`DROP ROLE "${role}"`);
    }
  });

  test('canonical foreign keys, one-to-one uniqueness, and number constraints stay enforced', async () => {
    await seedLegacy();
    await migrateSplit();
    const [user] = await client`SELECT id FROM users WHERE tekid_user_id='old-admin'`;
    for (const query of [
      () => client`INSERT INTO profiles (user_id) VALUES (gen_random_uuid())`,
      () => client`INSERT INTO memberships (user_id) VALUES (gen_random_uuid())`,
      () => client`INSERT INTO profiles (user_id) VALUES (${user!.id})`,
      () => client`INSERT INTO memberships (user_id) VALUES (${user!.id})`,
      () => client`UPDATE memberships SET member_number=17 WHERE user_id=(SELECT id FROM users WHERE tekid_user_id='old-draft')`,
      () => client`UPDATE memberships SET member_number=2147483647 WHERE user_id=${user!.id}`,
      () => client`UPDATE memberships SET status='approved' WHERE user_id=(SELECT id FROM users WHERE tekid_user_id='old-draft')`,
    ]) await assert.rejects(query);
    await client`DELETE FROM users WHERE id=${user!.id}`;
    assert.equal((await client`SELECT * FROM profiles WHERE user_id=${user!.id}`).length, 0);
    assert.equal((await client`SELECT * FROM memberships WHERE user_id=${user!.id}`).length, 0);
    assert.equal((await client`SELECT * FROM member_audit_logs WHERE target_id='old-admin'`).length, 1);
  });

  test('unexpected dependencies abort the entire split without losing or partially copying data', async () => {
    await seedLegacy();
    await client`CREATE VIEW unexpected_dependency AS SELECT tekid_user_id FROM member_profiles`;
    const original = await client`SELECT to_jsonb(p) AS row FROM member_profiles p ORDER BY tekid_user_id`;
    await assert.rejects(migrateSplit, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '2BP01');
    assert.deepEqual(await client`SELECT to_jsonb(p) AS row FROM member_profiles p ORDER BY tekid_user_id`, original);
    assert.equal((await client`SELECT to_regclass('public.users') AS users, to_regclass('public.member_number_seq') AS sequence`)[0]!.users, null);
    assert.equal((await client`SELECT next_number FROM member_number_counter WHERE id=1`)[0]!.next_number, 120);
    await client`DROP VIEW unexpected_dependency`;
    await client`ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY`;
    await assert.rejects(migrateSplit, /review of existing row policies or column grants/);
    await client`ALTER TABLE member_profiles DISABLE ROW LEVEL SECURITY`;
    await client`GRANT SELECT (name) ON member_profiles TO PUBLIC`;
    await assert.rejects(migrateSplit, /review of existing row policies or column grants/);
    assert.deepEqual(await client`SELECT to_jsonb(p) AS row FROM member_profiles p ORDER BY tekid_user_id`, original);
  });

  test('exhaustion preserves the sentinel and does not wrap member numbers', async () => {
    await client`UPDATE member_number_counter SET next_number=2147483647 WHERE id=1`;
    await migrateSplit();
    assert.deepEqual(await sequence(), { last_value: '2147483647', is_called: false });
    assert.equal(Number((await client`SELECT nextval('member_number_seq') AS n`)[0]!.n), 2147483647);
    await assert.rejects(() => client`SELECT nextval('member_number_seq')`);
    await client`INSERT INTO member_profiles (tekid_user_id) VALUES ('still-can-draft')`;
    assert.deepEqual(await sequence(), { last_value: '2147483647', is_called: true });
  });
});
