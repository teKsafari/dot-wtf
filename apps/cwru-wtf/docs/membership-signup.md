# Membership signup

A stranger applies at `/profile` with no account. An admin reviews the
application in the dashboard. Approving it creates the applicant's Club ID,
which is the credential for club resources, and shows the reviewer a
one-time sign-in link to pass on.

The landing page's "Get started" goes to `/profile`. There is one membership
form, not two: `/join` was a second copy of it and now redirects there
permanently, so links already shared still work.

## What an applicant does

`/profile` is public: no session, no cookie, no redirect to sign-in. An account
is what approval produces, so requiring one to apply would ask for the thing
the form exists to create. Somebody who is signed in sees the same questions
with their answers already filled in; somebody who is not sees the same
questions plus an email field and a photo upload.

The form asks for an email, a photo, and the answers the membership application
already requires (`lib/member-profile-fields.ts`): name, institution, WhatsApp,
portfolio, at least one category, a WTF idea, a current project, and a video.
GitHub, Instagram, LinkedIn and a short bio are optional.

The email becomes the Club ID, so it is validated as an address, not
only as a non-empty string, and it must not already belong to a dot*WTF account.

### The school-email rule

The club has no mailbox, so nothing can send a verification email. The domain
of the address is the only evidence that an applicant is a student, so
`MEMBER_EMAIL_DOMAINS` lists the domains an application may use and
`lib/email-domains.ts` decides. This repository is shared with another school,
so the list is per-instance configuration rather than a constant.

- A subdomain of a listed domain passes: `@cs.colby.edu` and
  `@alumni.colby.edu` are the same school as `colby.edu`. The match is on the
  label boundary, so `@notcolby.edu` does not pass.
- The check runs in `createApplicationService.submit`, before anything is
  stored, so a request that bypasses the browser is refused the same way. The
  message names the domains that would be accepted.
- An empty list accepts nobody. A value that parses to no usable domain fails
  startup instead, so the rule can never be configured into "accept everyone"
  by accident.
- The rule guards new applications only. A member already approved on another
  domain keeps their membership, and editing a profile never passes through
  this path: a member's address comes from their Club ID, and the form
  shows it read-only.

The photo is a JPEG, PNG or WebP of up to `UPLOADS_MAX_BYTES` (5 MB by default).
The declared type is ignored; the file's own first bytes decide. It is written
through the driver in `lib/uploads.ts` under `UPLOADS_DIR` and served from
`/api/uploads/<key>`, where the key is 16 random bytes. Moving these files to
object storage is a second `UploadStore`, not a change to the form or the queue.

A submitted application is a local identity with no Club ID subject yet:
`users.tekid_user_id` is null, `profiles` holds the answers and the photo, and
`memberships` is `pending` with `submitted_at`. **No member number is
allocated**: a number belongs to an approved member.

### Spam guard

Two measures, neither of them a third-party captcha:

- a honeypot field (`website`) that no person sees or fills. A filled one is
  answered exactly like a success, so a script learns nothing from the reply.
- two fixed windows per client address, held in the running process: thirty
  attempts an hour, which bounds what one address can make the server read, and
  five *complete* applications an hour. A form that comes back with a
  highlighted field does not spend the narrow window, so correcting a typo
  cannot lock an applicant out. Both are a speed bump for a public form, not an
  account control, and both reset when the container restarts.

## What a reviewer does

The dashboard's **Review queue** lists pending applications oldest first with
every answer and the photo. It needs the `members:review` permission, like
every other membership decision.

**Approve** runs one transaction, under the same advisory lock as every other
membership write:

1. create the Club ID from the applicant's email and name;
2. add it to `TEKID_MEMBER_GROUP`, creating that group if it is missing;
3. mint a one-time access token;
4. write the Club ID subject onto the local user, allocate the member number, set
   `approved` with `approved_at`, and record an `action_logs` entry and a
   `member_audit_logs` marker.

If any step fails, nothing is approved: the application stays pending and
reviewable. An approved member with no credential looks fine until they try to
use something, so that case is refused rather than repaired later. If the Club ID
was already created when the failure happened, it is deleted again, so a
retry does not hit "email already in use".

**Reject** marks the application `rejected` and records the decision. It creates
no Club ID.

## Handing over the credential

The club has no mailbox, so nothing is emailed. Approval shows the reviewer

    https://auth.mules.wtf/lc/<token>

with the instant it expires (`TEKID_LINK_TTL`, 12 hours by default). The link is
single use, and it is shown once, when the approval happens.

Because people lose it, the review screen keeps a second section, **Approved in
the last two weeks**, listing members approved in that window with a **Mint a
sign-in link** button. Minting again issues a new single-use link for the
account that already exists; it creates nothing and changes no membership.

## Naming

The word for the identity, everywhere a person can read it, is **Club ID**: the
upstream school's own name for its identity server means nothing here. The
internal names stay as they are — `lib/tekid/*`, `users.tekid_user_id`, the
`TEKID_*` variables, `/api/tekid/*` — because renaming them is a migration and
a repository-wide sweep for no change in behaviour.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `MEMBER_EMAIL_DOMAINS` | `colby.edu` | Email domains an application may use, comma separated. Subdomains of a listed domain pass. A value with no usable domain fails startup. |
| `TEKID_API_KEY` | — | Club identity server (Pocket ID) admin API key, sent as `X-API-KEY`. Without it approval answers 503 and changes nothing. |
| `TEKID_MEMBER_GROUP` | `members` | Group every approved member joins on the identity server. |
| `TEKID_LINK_TTL` | `12h` | Lifetime of the one-time sign-in link. |
| `UPLOADS_DIR` | `./.uploads` | Where application photos are written. `/data/uploads` in the container. |
| `UPLOADS_MAX_BYTES` | `5000000` | Largest photo accepted. |

In the container `/data` is a Coolify bind mount, which keeps the host
directory's root ownership. `entrypoint.sh` starts as root, chowns the mount,
and drops to `node` with `setpriv` before the migration or the server runs.

## Tests

```bash
pnpm test:applications
pnpm test:env
```

`pnpm test:env` covers the domain list: how it is parsed, that an unusable one
fails startup, that a subdomain passes and a lookalike does not.

The pure cases cover submission, both spam measures, the approval transaction,
and every failure path. Supply `APPLICATION_TEST_DATABASE_URL`, a disposable
loopback `dot_wtf_*_test` database, to also run them against PostgreSQL, where
the rollback and the `memberships_approval_check` constraint are real.
