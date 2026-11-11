// The school-email rule.
//
// The club has no mailbox, so nothing can send a verification email. The domain
// of the address is therefore the only evidence that an applicant is a student,
// and it is checked on the server before an application is ever stored.
//
// The list is per-instance configuration (MEMBER_EMAIL_DOMAINS), because this
// repository is shared with another school whose deployment accepts its own
// domains.

// What this club accepts when nothing is configured.
export const defaultMemberEmailDomains = 'colby.edu';

// Accepts "colby.edu, @cs.colby.edu" and whitespace or newline separated lists.
// Anything that is not a plausible domain is dropped rather than silently
// widening the rule to a prefix match on nonsense.
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function parseEmailDomains(value: string): string[] {
  const domains = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, ''))
    .filter((entry) => domainPattern.test(entry));
  return [...new Set(domains)];
}

// A subdomain of an accepted domain passes: schools hand out addresses like
// @cs.colby.edu and @alumni.colby.edu, and they belong to the same school.
// Matching on the label boundary, never on a bare suffix, so "notcolby.edu"
// does not pass because "colby.edu" is allowed.
export function emailDomainAllowed(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
  if (!domain) return false;
  // An empty list accepts nobody. A rule that is configured away must close the
  // door, not open it to everyone.
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export function formatEmailDomains(domains: readonly string[]): string {
  const addresses = domains.map((domain) => `@${domain}`);
  if (addresses.length === 0) return '';
  if (addresses.length === 1) return addresses[0]!;
  return `${addresses.slice(0, -1).join(', ')} or ${addresses[addresses.length - 1]!}`;
}

// Named so the applicant can see what would be accepted instead.
export function emailDomainMessage(domains: readonly string[]): string {
  return domains.length === 0
    ? 'Membership is closed to new email addresses right now.'
    : `Use your school email address, ending in ${formatEmailDomains(domains)}.`;
}
