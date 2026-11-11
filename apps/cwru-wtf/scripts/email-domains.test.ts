import { testEnvironment } from './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationEnv } from '../lib/env-schema';
import {
  defaultMemberEmailDomains, emailDomainAllowed, emailDomainMessage,
  formatEmailDomains, parseEmailDomains,
} from '../lib/email-domains';

test('the club accepts its school domain when nothing is configured', () => {
  assert.equal(createApplicationEnv(testEnvironment).MEMBER_EMAIL_DOMAINS.join(','), 'colby.edu');
  assert.equal(defaultMemberEmailDomains, 'colby.edu');
});

test('each deployment sets its own list, in any of the shapes people write', () => {
  const environment = createApplicationEnv({
    ...testEnvironment,
    MEMBER_EMAIL_DOMAINS: ' @CASE.edu , case.edu\ncwru.edu; students.CWRU.edu. ',
  });
  assert.deepEqual(environment.MEMBER_EMAIL_DOMAINS, ['case.edu', 'cwru.edu', 'students.cwru.edu']);
});

test('a list that holds no usable domain fails startup instead of accepting everyone', () => {
  for (const value of [',', ' ; ', 'not a domain', 'localhost']) {
    assert.throws(
      () => createApplicationEnv({ ...testEnvironment, MEMBER_EMAIL_DOMAINS: value }),
      /Invalid environment variables:.*MEMBER_EMAIL_DOMAINS/
    );
  }
  // An unset or blank value is the default, not an empty list.
  for (const value of [undefined, '']) {
    assert.deepEqual(
      createApplicationEnv({ ...testEnvironment, MEMBER_EMAIL_DOMAINS: value }).MEMBER_EMAIL_DOMAINS,
      ['colby.edu']
    );
  }
});

test('an empty list in code accepts nobody, so a rule configured away closes the door', () => {
  assert.equal(emailDomainAllowed('ada@colby.edu', []), false);
  assert.equal(emailDomainAllowed('ada@anything.example', []), false);
  assert.deepEqual(parseEmailDomains(''), []);
  assert.deepEqual(parseEmailDomains('not a domain, localhost'), []);
});

test('a subdomain of an accepted domain passes, and a lookalike does not', () => {
  const domains = ['colby.edu'];
  for (const email of ['ada@colby.edu', 'ada@CS.Colby.EDU', 'ada@alumni.colby.edu', 'ada@colby.edu.']) {
    assert.equal(emailDomainAllowed(email, domains), true, email);
  }
  for (const email of ['ada@notcolby.edu', 'ada@colby.edu.evil.test', 'ada@gmail.com', 'ada@colbyedu', 'ada']) {
    assert.equal(emailDomainAllowed(email, domains), false, email);
  }
});

test('an address with an @ in the local part is judged on the domain after the last one', () => {
  assert.equal(emailDomainAllowed('"a@b"@colby.edu', ['colby.edu']), true);
  assert.equal(emailDomainAllowed('a@colby.edu@gmail.com', ['colby.edu']), false);
});

test('the refusal names what is accepted', () => {
  assert.equal(formatEmailDomains(['colby.edu']), '@colby.edu');
  assert.equal(formatEmailDomains(['case.edu', 'cwru.edu']), '@case.edu or @cwru.edu');
  assert.equal(formatEmailDomains(['a.edu', 'b.edu', 'c.edu']), '@a.edu, @b.edu or @c.edu');
  assert.match(emailDomainMessage(['colby.edu']), /@colby\.edu/);
  assert.doesNotMatch(emailDomainMessage([]), /@/);
});
