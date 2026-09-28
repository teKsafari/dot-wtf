import './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyProfileFields, profileFieldsSchema, profileLimits } from '../lib/member-profile-fields';
import { createMemberProfiles, importedProfileFields } from '../lib/member-profiles';
import { createMemberDirectory } from '../lib/tekid/directory';
import { TekidManagementError, type TekidManagementClient } from '../lib/tekid/management';
import type { AuthContextType, AuthSession } from '../lib/tekid/types';

const claims = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  sub: 'ada', name: 'Ada Lovelace', username: null, email: 'Ada@Example.org',
  email_verified: true, picture: null, ...overrides,
});
const application = {
  wtfIdea: '  A loom that writes poetry  ',
  currentProject: 'Analytical engine notes',
  youtubeLink: 'https://www.youtube.com/watch?v=abc',
};

test('profile fields are trimmed, optional, and limited', () => {
  assert.deepEqual(profileFieldsSchema.parse({
    bio: '  Builder  ', wtfIdea: '', currentProject: ' x ', youtubeLink: ' https://youtu.be/abc ',
  }), { bio: 'Builder', wtfIdea: '', currentProject: 'x', youtubeLink: 'https://youtu.be/abc' });
  assert.equal(profileFieldsSchema.safeParse(emptyProfileFields).success, true);

  for (const [field, max] of [['bio', profileLimits.bio], ['wtfIdea', profileLimits.text], ['currentProject', profileLimits.text]] as const) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, [field]: 'x'.repeat(max) }).success, true);
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, [field]: 'x'.repeat(max + 1) }).success, false);
  }
});

test('the video field accepts only plain web links', () => {
  for (const link of ['https://www.youtube.com/watch?v=abc', 'http://drive.google.com/file/1']) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, youtubeLink: link }).success, true);
  }
  for (const link of [
    'javascript:alert(1)', 'data:text/html,hi', 'mailto:ada@example.org', 'youtube.com/watch?v=abc',
    'https://user:secret@example.org/video', 'not a link',
  ]) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, youtubeLink: link }).success, false, link);
  }
});

test('imported application answers always satisfy the profile schema', () => {
  assert.deepEqual(importedProfileFields(application), {
    bio: '', wtfIdea: 'A loom that writes poetry', currentProject: 'Analytical engine notes',
    youtubeLink: 'https://www.youtube.com/watch?v=abc',
  });

  const imported = importedProfileFields({
    wtfIdea: 'x'.repeat(profileLimits.text + 50), currentProject: '', youtubeLink: 'javascript:alert(1)',
  });
  assert.equal(imported.wtfIdea.length, profileLimits.text);
  assert.equal(imported.youtubeLink, '');
  assert.equal(profileFieldsSchema.safeParse(imported).success, true);
});

function profileFixture(options: { saved?: typeof emptyProfileFields; application?: typeof application; raceWith?: typeof emptyProfileFields } = {}) {
  const calls: string[] = [];
  let saved = options.saved ?? null;
  const profiles = createMemberProfiles({
    async findProfile(userId) {
      calls.push(`find:${userId}`);
      return saved;
    },
    async findApplication(email) {
      calls.push(`application:${email}`);
      return options.application ?? null;
    },
    async insertProfile(userId, fields) {
      calls.push(`insert:${userId}`);
      if (options.raceWith) {
        saved = options.raceWith;
        return false;
      }
      saved = fields;
      return true;
    },
  });
  return { profiles, calls };
}

test('a saved profile is never overwritten by the application', async () => {
  const saved = { ...emptyProfileFields, bio: 'Edited by me' };
  const { profiles, calls } = profileFixture({ saved, application });
  assert.deepEqual(await profiles.getProfile(claims()), { fields: saved, imported: false });
  assert.deepEqual(calls, ['find:ada']);
});

test('a verified email imports the matching application once', async () => {
  const { profiles, calls } = profileFixture({ application });
  const first = await profiles.getProfile(claims());
  assert.equal(first.imported, true);
  assert.deepEqual(first.fields, importedProfileFields(application));
  assert.deepEqual(calls, ['find:ada', 'application:Ada@Example.org', 'insert:ada']);

  assert.deepEqual(await profiles.getProfile(claims()), { fields: first.fields, imported: false });
});

test('an unverified email never claims an application', async () => {
  const { profiles, calls } = profileFixture({ application });
  assert.deepEqual(await profiles.getProfile(claims({ email_verified: false })), {
    fields: emptyProfileFields, imported: false,
  });
  assert.deepEqual(calls, ['find:ada']);
});

test('no matching application leaves an empty, unsaved profile', async () => {
  const { profiles, calls } = profileFixture();
  assert.deepEqual(await profiles.getProfile(claims()), { fields: emptyProfileFields, imported: false });
  assert.deepEqual(calls, ['find:ada', 'application:Ada@Example.org']);
});

test('a concurrent first visit returns the profile that won the insert', async () => {
  const winner = { ...emptyProfileFields, bio: 'Saved in another tab' };
  const { profiles } = profileFixture({ application, raceWith: winner });
  assert.deepEqual(await profiles.getProfile(claims()), { fields: winner, imported: false });
});

const organization = { organizationId: 'cwru', adminRoleId: 'admin-role', instanceLeadRoleId: 'lead-role' };
const user = (id: string, name: string | null, overrides: Record<string, unknown> = {}) => ({
  id, name, primaryEmail: `${id}@example.org`, avatar: null, isSuspended: false,
  customData: { private: true }, organizationRoles: [], ...overrides,
});

function directoryFixture(options: {
  auth?: AuthContextType;
  users?: ReturnType<typeof user>[];
  fail?: boolean;
} = {}) {
  const requests: string[] = [];
  const bioRequests: string[][] = [];
  const users = options.users ?? [];
  const management: TekidManagementClient = {
    async request(method, path, requestOptions = {}) {
      requests.push(`${method} ${path}`);
      if (options.fail) throw new TekidManagementError(503);
      const page = Number(requestOptions.query?.page ?? 1);
      const size = Number(requestOptions.query?.page_size ?? 20);
      return {
        data: users.slice((page - 1) * size, page * size),
        headers: new Headers({ 'total-number': String(users.length) }),
      };
    },
  };
  const getDirectory = createMemberDirectory({
    getAuthContext: async () => options.auth ?? { isAuthenticated: true, claims: claims() },
    management,
    organization,
    async loadBios(ids) {
      bioRequests.push(ids);
      return new Map([['ada', 'Poet of numbers'], ['grace', '']]);
    },
  });
  return { getDirectory, requests, bioRequests };
}

test('signed-out visitors get no member data', async () => {
  const { getDirectory, requests } = directoryFixture({ auth: { isAuthenticated: false, claims: null } });
  assert.deepEqual(await getDirectory(), { status: 'signed-out' });
  assert.deepEqual(requests, []);
});

test('only active organization members can open the directory', async () => {
  const outsider = directoryFixture({ users: [user('grace', 'Grace Hopper')] });
  assert.deepEqual(await outsider.getDirectory(), { status: 'not-member' });
  assert.deepEqual(outsider.bioRequests, []);

  const suspended = directoryFixture({ users: [user('ada', 'Ada', { isSuspended: true }), user('grace', 'Grace')] });
  assert.deepEqual(await suspended.getDirectory(), { status: 'not-member' });
});

test('members see active members with name, photo, and bio only', async () => {
  const { getDirectory, requests, bioRequests } = directoryFixture({
    users: [
      user('grace', 'grace hopper', { avatar: 'https://images.example.org/grace.png' }),
      user('nameless', '  '),
      user('ada', 'Ada Lovelace', { avatar: 'javascript:alert(1)' }),
      user('mallory', 'Mallory', { isSuspended: true }),
    ],
  });

  assert.deepEqual(await getDirectory(), {
    status: 'member',
    viewerId: 'ada',
    members: [
      { id: 'ada', name: 'Ada Lovelace', picture: null, bio: 'Poet of numbers' },
      { id: 'grace', name: 'grace hopper', picture: 'https://images.example.org/grace.png', bio: '' },
      { id: 'nameless', name: null, picture: null, bio: '' },
    ],
  });
  assert.deepEqual(requests, ['GET /api/organizations/cwru/users']);
  assert.deepEqual(bioRequests, [['grace', 'nameless', 'ada']]);
});

test('directory failures are not reported as an empty directory', async () => {
  const { getDirectory } = directoryFixture({ users: [user('ada', 'Ada')], fail: true });
  await assert.rejects(getDirectory(), TekidManagementError);
});
