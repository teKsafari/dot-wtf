import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applicationFieldsSchema, categoryOptions, emptyProfileFields, profileFieldsFromFormData,
  profileFieldsSchema, profileLimits, safeSocialLinks,
} from '../lib/member-profile-fields';

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

const completeApplication = {
  ...emptyProfileFields,
  name: 'Ada Lovelace',
  institution: 'CWRU, Cleveland',
  whatsapp: '+1 555 000 0000',
  categories: ['Research'],
  wtfIdea: 'A loom that writes poetry',
  currentProject: 'Analytical engine notes',
  youtubeLink: 'https://youtu.be/abc',
  portfolio: 'ada.dev',
};

test('drafts can be incomplete, but submitting requires every live application answer', () => {
  assert.equal(profileFieldsSchema.safeParse(emptyProfileFields).success, true);
  assert.equal(applicationFieldsSchema.safeParse(completeApplication).success, true);
  for (const field of ['name', 'institution', 'whatsapp', 'wtfIdea', 'currentProject', 'youtubeLink', 'portfolio'] as const) {
    const fields = { ...completeApplication, [field]: '  ' };
    assert.equal(profileFieldsSchema.safeParse(fields).success, true, `${field} may be saved in a draft`);
    const result = applicationFieldsSchema.safeParse(fields);
    assert.equal(result.success, false, `${field} is required for submission`);
    if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === field));
  }
  assert.equal(applicationFieldsSchema.safeParse({ ...completeApplication, categories: [] }).success, false);
});

test('category choices match the live form and Other requires a description only on submission', () => {
  assert.deepEqual(categoryOptions, [
    'Research', 'Photography / Videography', 'Hardware / Electronics',
    'Software / Coding', 'Arts / Design', 'Architecture', 'Other',
  ]);
  const other = { ...completeApplication, categories: ['Other'], otherCategory: '' };
  assert.equal(profileFieldsSchema.safeParse(other).success, true);
  assert.equal(applicationFieldsSchema.safeParse(other).success, false);
  assert.equal(applicationFieldsSchema.safeParse({ ...other, otherCategory: 'Robotics' }).success, true);
  assert.equal(profileFieldsSchema.safeParse({ ...other, categories: ['Unknown category'] }).success, false);
  assert.deepEqual(profileFieldsSchema.parse({ ...other, categories: ['Research', 'Research'] }).categories, ['Research']);
});

test('application answers stop at 600 characters while longer existing drafts remain editable', () => {
  for (const field of ['wtfIdea', 'currentProject'] as const) {
    assert.equal(applicationFieldsSchema.safeParse({ ...completeApplication, [field]: 'x'.repeat(600) }).success, true);
    assert.equal(applicationFieldsSchema.safeParse({ ...completeApplication, [field]: 'x'.repeat(601) }).success, false);
    assert.equal(profileFieldsSchema.safeParse({ ...completeApplication, [field]: 'x'.repeat(2000) }).success, true);
    assert.equal(profileFieldsSchema.safeParse({ ...completeApplication, [field]: 'x'.repeat(2001) }).success, false);
  }
});

test('phone numbers allow international punctuation and reject malformed contact details', () => {
  for (const whatsapp of ['+1 (555) 000-0000', '+44 20 7946 0958', '']) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, whatsapp }).success, true);
  }
  for (const whatsapp of ['email@example.org', '123', '+1234567890123456', '++15550000000']) {
    assert.equal(profileFieldsSchema.safeParse({ ...emptyProfileFields, whatsapp }).success, false, whatsapp);
  }
});

test('form data preserves multiple categories and cannot set identity or access fields', () => {
  const data = new FormData();
  data.append('categories', 'Research');
  data.append('categories', 'Arts / Design');
  data.append('categories', new Blob(['not a category']));
  data.set('name', 'Local name');
  data.set('institution', 'CWRU, Cleveland');
  for (const field of ['tekidUserId', 'email', 'emailVerified', 'status', 'applicationStatus', 'role', 'memberNumber', 'picture', 'approvedAt', 'reviewedBy', 'intent']) {
    data.set(field, 'untrusted');
  }
  assert.deepEqual(profileFieldsFromFormData(data), {
    ...emptyProfileFields,
    name: 'Local name', institution: 'CWRU, Cleveland', categories: ['Research', 'Arts / Design'],
  });
  const parsed = profileFieldsSchema.parse({ ...completeApplication, status: 'approved', role: 'admin', memberNumber: 1 });
  assert.equal('status' in parsed, false);
  assert.equal('role' in parsed, false);
  assert.equal('memberNumber' in parsed, false);
});
