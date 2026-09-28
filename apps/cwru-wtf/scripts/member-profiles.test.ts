import './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyProfileFields, profileFieldsFromFormData, profileFieldsSchema, profileLimits, safeSocialLinks,
} from '../lib/member-profile-fields';
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
    ...emptyProfileFields, bio: '  Builder  ', currentProject: ' x ', youtubeLink: ' https://youtu.be/abc ',
  }), { ...emptyProfileFields, bio: 'Builder', currentProject: 'x', youtubeLink: 'https://youtu.be/abc' });
  assert.equal(profileFieldsSchema.safeParse(emptyProfileFields).success, true);

  for (const [field, max] of [['bio', profileLimits.bio], ['wtfIdea', profileLimits.text], ['currentProject', profileLimits.text]] as const) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, [field]: 'x'.repeat(max) }).success, true);
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, [field]: 'x'.repeat(max + 1) }).success, false);
  }
});

test('submitted CRLF line breaks count once, as the textarea counts them', () => {
  const lines = 'x'.repeat(98);
  const bio = Array.from({ length: 5 }, () => lines).join('\r\n');
  assert.equal(bio.replace(/\r\n/g, '\n').length, 494);
  const parsed = profileFieldsSchema.safeParse({ ...emptyProfileFields, bio: `${bio}\r\nabcde` });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.bio.includes('\r'), false);
  assert.equal(parsed.success && parsed.data.bio.length, profileLimits.bio);
});

test('form data yields exactly the profile fields, as strings', () => {
  const formData = new FormData();
  formData.set('bio', 'Hi');
  formData.set('github', 'octocat');
  formData.set('$ACTION_ID_abc', 'ignored');
  formData.set('tekidUserId', 'someone-else');
  formData.set('portfolio', new Blob(['not text']));
  assert.deepEqual(profileFieldsFromFormData(formData), { ...emptyProfileFields, bio: 'Hi', github: 'octocat' });
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

const parseLink = (field: 'github' | 'instagram' | 'linkedin' | 'portfolio', value: string) =>
  profileFieldsSchema.safeParse({ ...emptyProfileFields, [field]: value });

test('social handles and links become https links on the right site', () => {
  const cases = {
    github: [
      ['octocat', 'https://github.com/octocat'],
      ['@octocat', 'https://github.com/octocat'],
      ['github.com/octocat', 'https://github.com/octocat'],
      ['http://www.github.com/octocat/', 'https://www.github.com/octocat/'],
    ],
    instagram: [
      ['ada.lovelace', 'https://www.instagram.com/ada.lovelace/'],
      ['@ada_lovelace', 'https://www.instagram.com/ada_lovelace/'],
      ['https://instagram.com/ada.lovelace', 'https://instagram.com/ada.lovelace'],
    ],
    linkedin: [
      ['ada-lovelace', 'https://www.linkedin.com/in/ada-lovelace'],
      ['linkedin.com/in/ada-lovelace', 'https://linkedin.com/in/ada-lovelace'],
      ['https://www.linkedin.com/in/ada-lovelace/', 'https://www.linkedin.com/in/ada-lovelace/'],
    ],
    portfolio: [
      ['ada.dev', 'https://ada.dev/'],
      ['http://ada.dev/work', 'http://ada.dev/work'],
      ['https://ada.dev/?ref=cwru', 'https://ada.dev/?ref=cwru'],
    ],
  } as const;

  for (const [field, pairs] of Object.entries(cases) as [keyof typeof cases, readonly (readonly [string, string])[]][]) {
    for (const [input, expected] of pairs) {
      const parsed = parseLink(field, input);
      assert.equal(parsed.success && parsed.data[field], expected, `${field}: ${input}`);
    }
  }
  assert.equal(parseLink('github', '   ').success && parseLink('github', '   ').data?.github, '');
});

test('social links reject other sites and unsafe schemes', () => {
  const rejected = {
    github: ['javascript:alert(1)', 'https://evil.example/github.com/octocat', 'https://github.com', 'github.com', 'bad--name', 'https://user:pw@github.com/octocat'],
    instagram: ['https://instagram.com.evil.example/ada', 'instagram.com', 'has space', 'data:text/html,hi'],
    linkedin: ['https://notlinkedin.com/in/ada', 'ab', 'mailto:ada@example.org'],
    portfolio: ['javascript:alert(1)', 'data:text/html,hi', 'localhost:3000', 'not a site', 'ftp://ada.dev/file'],
  } as const;

  for (const [field, values] of Object.entries(rejected) as [keyof typeof rejected, readonly string[]][]) {
    for (const value of values) {
      assert.equal(parseLink(field, value).success, false, `${field}: ${value}`);
    }
  }
});

test('normalized links that outgrow the limit are rejected, never saved and dropped', () => {
  const tooLong = [
    ['github', `github.com/${'a'.repeat(189)}`],
    ['github', `http://github.com/${'a'.repeat(182)}`],
    ['linkedin', `https://www.linkedin.com/in/${'é'.repeat(60)}`],
    ['portfolio', `example.com/${'a'.repeat(488)}`],
    ['portfolio', `https://example.com/${'é'.repeat(100)}`],
  ] as const;
  for (const [field, input] of tooLong) {
    const parsed = parseLink(field, input);
    assert.equal(parsed.success, false, `${field}: ${input.slice(0, 40)}`);
    assert.equal(!parsed.success && parsed.error.issues[0].message, 'This link is too long.');
  }
});

test('Instagram dot handles and non-default ports are rejected', () => {
  for (const value of ['.', '..', '@..', '.ada', 'ada.', 'ada..lovelace']) {
    assert.equal(parseLink('instagram', value).success, false, `instagram: ${value}`);
  }
  for (const [field, value] of [
    ['github', 'https://github.com:22/ada'],
    ['github', 'github.com:8080/ada'],
    ['instagram', 'https://www.instagram.com:444/ada'],
    ['linkedin', 'https://www.linkedin.com:8443/in/ada'],
  ] as const) {
    assert.equal(parseLink(field, value).success, false, `${field}: ${value}`);
  }
  const upgraded = parseLink('github', 'http://github.com:443/ada');
  assert.equal(upgraded.success && upgraded.data.github, 'https://github.com/ada');
});

test('a portfolio host with a port is a site, not a URL scheme', () => {
  const parsed = parseLink('portfolio', 'ada.dev:8080/work');
  assert.equal(parsed.success && parsed.data.portfolio, 'https://ada.dev:8080/work');
  assert.equal(parseLink('portfolio', 'localhost:3000').success, false);
});

test('every accepted link round-trips through storage unchanged', () => {
  const inputs = {
    github: ['octocat', '@octocat', 'github.com/octocat', 'http://www.github.com/octocat/', 'https://gist.github.com/octocat/abc', `github.com/${'a'.repeat(170)}`, 'HTTPS://GitHub.com/Octocat'],
    instagram: ['ada.lovelace', '@ada_lovelace', 'instagram.com/ada', 'https://m.instagram.com/ada/', 'a'.repeat(30)],
    linkedin: ['ada-lovelace', 'linkedin.com/in/ada', 'https://uk.linkedin.com/in/ada?trk=x', 'https://www.linkedin.com/company/cwru', `https://www.linkedin.com/in/${'é'.repeat(10)}`],
    portfolio: ['ada.dev', 'http://ada.dev/work', 'ada.dev:8080', 'https://bücher.example/', `example.com/${'a'.repeat(470)}`],
  } as const;
  for (const [field, values] of Object.entries(inputs) as [keyof typeof inputs, readonly string[]][]) {
    for (const value of values) {
      const first = parseLink(field, value);
      assert.equal(first.success, true, `${field} accepts ${value.slice(0, 40)}`);
      const stored = first.success ? first.data[field] : '';
      const again = parseLink(field, stored);
      assert.equal(again.success && again.data[field], stored, `${field} is stable for ${value.slice(0, 40)}`);
      assert.deepEqual(safeSocialLinks({ [field]: stored }), { [field]: stored }, `${field} survives the read check`);
    }
  }
});

test('stored social links are re-checked before they are shown', () => {
  assert.deepEqual(safeSocialLinks({
    github: 'https://github.com/octocat',
    instagram: 'javascript:alert(1)',
    linkedin: 42,
    portfolio: 'https://ada.dev/',
    twitter: 'https://twitter.com/ada',
  }), { github: 'https://github.com/octocat', portfolio: 'https://ada.dev/' });
  for (const value of [null, undefined, 'https://github.com/octocat', [], 7]) {
    assert.deepEqual(safeSocialLinks(value), {});
  }
});

test('imported application answers always satisfy the profile schema', () => {
  assert.deepEqual(importedProfileFields(application), {
    ...emptyProfileFields, wtfIdea: 'A loom that writes poetry', currentProject: 'Analytical engine notes',
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
    async loadCards(ids) {
      bioRequests.push(ids);
      return new Map([
        ['ada', { bio: 'Poet of numbers', links: { github: 'https://github.com/ada' } }],
        ['grace', { bio: '', links: {} }],
      ]);
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

test('members see active members with name, photo, bio, and links only', async () => {
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
      { id: 'ada', name: 'Ada Lovelace', picture: null, bio: 'Poet of numbers', links: { github: 'https://github.com/ada' } },
      { id: 'grace', name: 'grace hopper', picture: 'https://images.example.org/grace.png', bio: '', links: {} },
      { id: 'nameless', name: null, picture: null, bio: '', links: {} },
    ],
  });
  assert.deepEqual(requests, ['GET /api/organizations/cwru/users']);
  assert.deepEqual(bioRequests, [['grace', 'nameless', 'ada']]);
});

test('directory failures are not reported as an empty directory', async () => {
  const { getDirectory } = directoryFixture({ users: [user('ada', 'Ada')], fail: true });
  await assert.rejects(getDirectory(), TekidManagementError);
});
