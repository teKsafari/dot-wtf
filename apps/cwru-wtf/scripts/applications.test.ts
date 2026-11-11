import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApplicationError, applicationHoneypotField, createApplicationService,
  type ApplicationRecord, type ApplicationStore, type ApplicationTransaction,
} from '../lib/applications';
import { createRateLimiter } from '../lib/rate-limit';
import { TekidAdminError, type TekidAdminClient } from '../lib/tekid/admin';
import { emptyProfileFields, type ProfileFields } from '../lib/member-profile-fields';
import type { UploadStore } from '../lib/uploads';

const now = new Date('2026-11-11T12:00:00.000Z');
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

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

function photo(bytes = pngBytes) {
  return new File([bytes], 'ada.png', { type: 'image/png' });
}

// A store whose transaction really rolls back: the state is restored whenever
// the operation throws, which is what the approval failure path depends on.
function createMemoryStore() {
  const state = { records: [] as ApplicationRecord[], actions: [] as string[], audits: [] as string[], nextNumber: 1 };
  const store: ApplicationStore = {
    async transaction(operation) {
      const snapshot = JSON.parse(JSON.stringify(state, (_key, value) => value)) as typeof state;
      const transaction: ApplicationTransaction = {
        async findByEmail(email) {
          return state.records.find((record) => record.email === email) ?? null;
        },
        async create({ email, fields, picture, submittedAt }) {
          const record: ApplicationRecord = {
            userId: `user-${state.records.length + 1}`, tekidUserId: null, email,
            status: 'pending', memberNumber: null, picture, submittedAt, approvedAt: null, fields,
          };
          state.records.push(record);
          return record;
        },
        async listPending() {
          return state.records.filter((record) => record.status === 'pending' && !record.tekidUserId);
        },
        async listRecentlyApproved(since) {
          return state.records.filter((record) =>
            record.status === 'approved' && record.approvedAt !== null && record.approvedAt >= since);
        },
        async find(userId) {
          return state.records.find((record) => record.userId === userId) ?? null;
        },
        async approve(userId, changes) {
          const record = state.records.find((entry) => entry.userId === userId)!;
          Object.assign(record, {
            tekidUserId: changes.tekidUserId, status: 'approved',
            memberNumber: changes.memberNumber, approvedAt: changes.at,
          });
          return record;
        },
        async reject(userId) {
          const record = state.records.find((entry) => entry.userId === userId)!;
          record.status = 'rejected';
          return record;
        },
        async reserveMemberNumber() {
          return state.nextNumber++;
        },
        async logAction(action, details) {
          state.actions.push(`${action}:${details}`);
        },
        async audit(event) {
          state.audits.push(event.action);
        },
      };
      try {
        return await operation(transaction);
      } catch (error) {
        // A sequence does not roll back, and neither does this counter.
        const nextNumber = state.nextNumber;
        state.records = snapshot.records.map((record) => ({
          ...record,
          submittedAt: record.submittedAt ? new Date(record.submittedAt) : null,
          approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
        }));
        state.actions = snapshot.actions;
        state.audits = snapshot.audits;
        state.nextNumber = nextNumber;
        throw error;
      }
    },
  };
  return { state, store };
}

function createMemoryUploads() {
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
    async delete(key) {
      files.delete(key);
    },
  };
  return { files, uploads };
}

function createFakeTekid(overrides: Partial<TekidAdminClient> = {}) {
  const calls: string[] = [];
  const client: TekidAdminClient = {
    async createUser() {
      calls.push('createUser');
      return { id: 'tekid-1', username: 'ada', email: 'ada@example.org' };
    },
    async deleteUser(id) {
      calls.push(`deleteUser:${id}`);
    },
    async findGroupByName() {
      calls.push('findGroupByName');
      return { id: 'group-1', name: 'members' };
    },
    async createGroup(name) {
      calls.push('createGroup');
      return { id: 'group-1', name };
    },
    async setUserGroups() {
      calls.push('setUserGroups');
    },
    async createOneTimeAccessToken() {
      calls.push('createOneTimeAccessToken');
      return 'abcdefghijkl';
    },
    signInLink(token) {
      return `https://auth.mules.wtf/lc/${token}`;
    },
    ...overrides,
  };
  return { calls, client };
}

function createService(options: { tekid?: Partial<TekidAdminClient>; domains?: string[] } = {}) {
  const { state, store } = createMemoryStore();
  const { files, uploads } = createMemoryUploads();
  const tekid = createFakeTekid(options.tekid);
  const service = createApplicationService({
    store, uploads,
    tekid: () => tekid.client,
    allowedEmailDomains: options.domains ?? ['example.org'],
    memberGroup: 'members',
    linkTtl: '12h',
    maximumUploadBytes: 5_000_000,
    photoUrl: (key) => `https://mules.wtf/api/uploads/${key}`,
    photoKey: (url) => url.split('/').pop() ?? null,
    limiter: createRateLimiter(5, 60_000),
    attemptLimiter: createRateLimiter(30, 60_000),
    now: () => now,
  });
  return { service, state, files, tekid };
}

async function submitOne(service: ReturnType<typeof createService>['service'], email = 'ada@example.org') {
  return service.submit({
    email, fields: completeFields(), photo: photo(),
    honeypot: '', clientAddress: '198.51.100.7',
  });
}

test('a stranger submits a pending application that consumes no member number', async () => {
  const { service, state, files } = createService();
  const view = await submitOne(service);

  assert.equal(view.status, 'pending');
  assert.equal(view.memberNumber, null);
  assert.equal(view.submittedAt, now.toISOString());
  assert.match(view.photoUrl!, /^https:\/\/mules\.wtf\/api\/uploads\//);
  assert.equal(state.records[0]!.tekidUserId, null);
  assert.equal(state.nextNumber, 1);
  assert.equal(files.size, 1);
});

test('the honeypot answers like a success and stores nothing', async () => {
  const { service, state, files } = createService();
  await assert.rejects(
    service.submit({
      email: 'bot@example.org', fields: completeFields(), photo: photo(),
      honeypot: 'https://buy.example', clientAddress: '198.51.100.8',
    }),
    (error: unknown) => error instanceof ApplicationError && error.status === 400 && Object.keys(error.errors).length === 0
  );
  assert.equal(state.records.length, 0);
  assert.equal(files.size, 0);
});

test('one address cannot submit more than the window allows', async () => {
  const { service } = createService();
  for (let index = 0; index < 5; index += 1) {
    await submitOne(service, `ada${index}@example.org`);
  }
  await assert.rejects(submitOne(service, 'ada5@example.org'),
    (error: unknown) => error instanceof ApplicationError && error.status === 429);
});

test('a rejected form does not spend the applicant\'s own window', async () => {
  const { service } = createService();
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      service.submit({
        email: 'ada@example.org', fields: { ...emptyProfileFields, name: 'Ada' },
        photo: photo(), honeypot: '', clientAddress: '198.51.100.7',
      }),
      (error: unknown) => error instanceof ApplicationError && error.status === 400
    );
  }
  const view = await submitOne(service);
  assert.equal(view.status, 'pending');
});

test('a file that is not an image, and an incomplete form, are reported per field', async () => {
  const { service, state, files } = createService();
  await assert.rejects(
    service.submit({
      email: 'not-an-email', fields: { ...emptyProfileFields, name: 'Ada' },
      photo: new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'resume.pdf', { type: 'image/png' }),
      honeypot: '', clientAddress: '198.51.100.9',
    }),
    (error: unknown) => error instanceof ApplicationError && error.status === 400
      && Boolean(error.errors.email) && Boolean(error.errors.photo) && Boolean(error.errors.wtfIdea)
  );
  assert.equal(state.records.length, 0);
  assert.equal(files.size, 0);
});

test('an address outside the school domains is refused, and nothing is stored', async () => {
  const { service, state, files } = createService({ domains: ['colby.edu'] });
  await assert.rejects(
    service.submit({
      email: 'ada@gmail.com', fields: completeFields(), photo: photo(),
      honeypot: '', clientAddress: '198.51.100.21',
    }),
    (error: unknown) => error instanceof ApplicationError && error.status === 400
      // The message names what would be accepted instead.
      && /@colby\.edu/.test(error.errors.email ?? '')
  );
  assert.equal(state.records.length, 0);
  assert.equal(files.size, 0);
});

test('a school address, including a subdomain of one, lands as pending', async () => {
  for (const email of ['ada@colby.edu', 'grace@CS.Colby.edu']) {
    const { service, state } = createService({ domains: ['colby.edu'] });
    const view = await service.submit({
      email, fields: completeFields(), photo: photo(),
      honeypot: '', clientAddress: '198.51.100.22',
    });
    assert.equal(view.status, 'pending');
    assert.equal(view.memberNumber, null);
    assert.equal(state.records[0]!.email, email.toLowerCase());
  }
});

test('an empty domain list accepts nobody rather than everybody', async () => {
  const { service, state, files } = createService({ domains: [] });
  await assert.rejects(
    service.submit({
      email: 'ada@colby.edu', fields: completeFields(), photo: photo(),
      honeypot: '', clientAddress: '198.51.100.23',
    }),
    (error: unknown) => error instanceof ApplicationError && error.status === 400
      && Boolean(error.errors.email)
  );
  assert.equal(state.records.length, 0);
  assert.equal(files.size, 0);
});

// The club's first admin joined before the rule existed, on the club's own
// domain rather than the school's. The rule guards new applications only, so
// their record keeps working and their own profile edits never reach this path
// (a member's address comes from their Club ID; the form cannot change it).
test('an approved member on a domain the rule no longer accepts keeps their membership', async () => {
  const { service, state } = createService({ domains: ['example.org'] });
  await service.submit({
    email: 'founder@example.org', fields: completeFields(), photo: photo(),
    honeypot: '', clientAddress: '198.51.100.24',
  });
  const grandfathered = state.records[0]!;
  // The live row: member #1, admin, on a domain the allowlist does not hold.
  grandfathered.email = 'nehemia@mules.wtf';

  const approved = await service.approve(grandfathered.userId, 'bootstrap');
  assert.equal(approved.application.status, 'approved');
  assert.equal(approved.application.memberNumber, 1);
  assert.equal(approved.application.email, 'nehemia@mules.wtf');

  // Everything a reviewer can still do for that member works with the rule on.
  const link = await service.remintSignInLink(grandfathered.userId, 'bootstrap');
  assert.match(link.url, /^https:\/\/auth\.mules\.wtf\/lc\//);
  const queue = await service.listQueue();
  assert.equal(queue.pending.length, 0);
  assert.equal(queue.recentlyApproved[0]!.email, 'nehemia@mules.wtf');
});

test('the same email cannot apply twice, and the second photo is not kept', async () => {
  const { service, state, files } = createService();
  await submitOne(service);
  await assert.rejects(submitOne(service),
    (error: unknown) => error instanceof ApplicationError && error.status === 409);
  assert.equal(state.records.length, 1);
  assert.equal(files.size, 1);
});

test('approval creates the club account, the member number and the sign-in link together', async () => {
  const { service, state, tekid } = createService();
  const application = await submitOne(service);

  const { application: approved, link } = await service.approve(application.userId, 'admin-sub');

  assert.equal(approved.status, 'approved');
  assert.equal(approved.memberNumber, 1);
  assert.equal(state.records[0]!.tekidUserId, 'tekid-1');
  assert.equal(state.records[0]!.approvedAt?.toISOString(), now.toISOString());
  assert.equal(link.url, 'https://auth.mules.wtf/lc/abcdefghijkl');
  assert.equal(link.expiresAt, new Date('2026-11-12T00:00:00.000Z').toISOString());
  assert.deepEqual(state.actions, ['approved:member 1 (user-1)']);
  assert.deepEqual(state.audits, ['member.approve-application']);
  assert.deepEqual(tekid.calls, [
    'createUser', 'findGroupByName', 'setUserGroups', 'createOneTimeAccessToken',
  ]);
  const queue = await service.listQueue();
  assert.equal(queue.pending.length, 0);
  // The approved applicant stays reachable, so a lost link can be minted again.
  assert.deepEqual(queue.recentlyApproved.map((entry) => entry.memberNumber), [1]);
});

test('an identity-service failure leaves the application pending, with no number and no log', async () => {
  const { service, state, tekid } = createService({
    tekid: {
      async createUser() {
        throw new TekidAdminError(503, null, 'The club identity service did not answer.');
      },
    },
  });
  const application = await submitOne(service);

  await assert.rejects(service.approve(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 503);

  assert.equal(state.records[0]!.status, 'pending');
  assert.equal(state.records[0]!.memberNumber, null);
  assert.equal(state.records[0]!.tekidUserId, null);
  assert.deepEqual(state.actions, []);
  assert.deepEqual(state.audits, []);
  assert.equal(tekid.calls.filter((call) => call.startsWith('deleteUser')).length, 0);
});

test('a failure after the account exists rolls the record back and deletes that account', async () => {
  const { service, state, tekid } = createService({
    tekid: {
      async createOneTimeAccessToken() {
        throw new TekidAdminError(500, null, 'The club identity service rejected the request (500).');
      },
    },
  });
  const application = await submitOne(service);

  await assert.rejects(service.approve(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 503);

  assert.equal(state.records[0]!.status, 'pending');
  assert.equal(state.records[0]!.memberNumber, null);
  assert.equal(state.records[0]!.tekidUserId, null);
  assert.deepEqual(state.actions, []);
  assert.ok(tekid.calls.includes('deleteUser:tekid-1'));
  assert.equal(((await service.listQueue()).pending).length, 1);
});

test('an email the identity service already holds is reported as a conflict, not a half approval', async () => {
  const { service, state } = createService({
    tekid: {
      async createUser() {
        throw new TekidAdminError(409, 'already_in_use', 'The club identity service rejected the request (409).');
      },
    },
  });
  const application = await submitOne(service);
  await assert.rejects(service.approve(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 409);
  assert.equal(state.records[0]!.status, 'pending');
});

test('an application can only be reviewed once', async () => {
  const { service } = createService();
  const application = await submitOne(service);
  await service.approve(application.userId, 'admin-sub');
  await assert.rejects(service.approve(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 409);
  await assert.rejects(service.reject(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 409);
});

test('rejection records the decision and empties the queue', async () => {
  const { service, state } = createService();
  const application = await submitOne(service);
  const rejected = await service.reject(application.userId, 'admin-sub');
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(state.actions, ['rejected:application user-1']);
  assert.equal(((await service.listQueue()).pending).length, 0);
});

test('a lost link can be minted again for an approved member only', async () => {
  const { service } = createService();
  const application = await submitOne(service);
  await assert.rejects(service.remintSignInLink(application.userId, 'admin-sub'),
    (error: unknown) => error instanceof ApplicationError && error.status === 409);
  await service.approve(application.userId, 'admin-sub');
  const link = await service.remintSignInLink(application.userId, 'admin-sub');
  assert.equal(link.url, 'https://auth.mules.wtf/lc/abcdefghijkl');
});

test('the honeypot field name is the one the form renders', () => {
  assert.equal(applicationHoneypotField, 'website');
});
