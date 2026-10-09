# dot\*WTF website

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)

> A student-led collective for builders, tinkerers, and dreamers. The site is served at [dott.wtf](https://dott.wtf).

## What is dot\*WTF?

This isn't a club where we talk about doing things—it's where we **actually do them**. We build hardware hacks, AI experiments, large-scale art, films, open-source tools, weird websites, and games. Anything that makes you say "wtf, I wanna try that."

### What We Do

- **Build Anything** — Hardware, AI, art, films, open-source tools, weird websites, game dev
- **Learn by Doing** — No experience required. Just curiosity and a willingness to build
- **Ship It** — Late-night build sessions, mentorship, and collaborative projects

### Featured Projects

- **FPGA Multilayer Perceptron** — Custom "AI" on custom hardware
- **CWRU Games** — Games by CWRU students, for CWRU students ([games.cwru.wtf](https://games.cwru.wtf))
- **WTF Supercomputer** — Distributed compute cluster from donated student machines
- **Interactive Art** — Environmental-responsive art installations

## Tech Stack

- **Framework:** Next.js 16
- **Database:** PostgreSQL with Drizzle ORM
- **Styling:** Tailwind CSS
- **Deployment:** Vercel

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Database migrations
pnpm db:migrate
```

Open [http://dot-wtf.localhost:1355](http://dot-wtf.localhost:1355). Portless manages the app’s internal port.

Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and the four `LOGTO_*` sign-in values before starting or building. [`env.ts`](env.ts) exposes the typed configuration, validated with `@t3-oss/env-core` and Zod. Application code imports `env` instead of reading `process.env`; the schema lives in [`lib/env-schema.ts`](lib/env-schema.ts). Next.js loads `.env` files, and CLI entry points that import application modules use `scripts/load-env.ts`. The environment module does not load files.

`next.config.mjs` imports the validation before development, build, and server startup, so invalid required settings stop the command with the variable names. Tally settings are optional legacy configuration; both former intake endpoints return 410 and current applications are submitted through `/profile`. Turbo forwards and hashes the required Logto variables for builds. `LOGTO_BASE_URL` is the application's HTTP(S) origin and must use HTTPS for a production build. To verify a production build locally, run `LOGTO_BASE_URL=https://dott.wtf pnpm build`; keep the local `.env.local` origin set to Portless for development.

## tekID profiles

[/profile](http://dot-wtf.localhost:1355/profile) starts a tekID sign-in or account creation flow and returns to the member's editable profile (see [Member applications and directory](#member-applications-and-directory)). tekID provides identity claims; the member edits their local application profile in PostgreSQL. [/admin](http://dot-wtf.localhost:1355/admin) uses the same tekID session; there is no separate admin password or login form. Approved local membership and a local dashboard role determine dashboard access.

Use the **dot-wtf** Traditional web application in the tekID Logto console. Copy `LOGTO_APP_ID` and `LOGTO_APP_SECRET` into `.env.local`, set `LOGTO_BASE_URL`, and generate a separate `LOGTO_COOKIE_SECRET` of at least 32 characters (`openssl rand -hex 32`). These values are server-only; never prefix them with `NEXT_PUBLIC_` or commit secrets.

Register these exact URLs in that application:

| Environment | Redirect URI | Post sign-out redirect URI |
| --- | --- | --- |
| Local | `http://dot-wtf.localhost:1355/api/tekid/callback` | `http://dot-wtf.localhost:1355/profile` |
| Production | `https://dott.wtf/api/tekid/callback` | `https://dott.wtf/profile` |

Set `LOGTO_BASE_URL=https://dott.wtf`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, and `LOGTO_COOKIE_SECRET` in the production deployment before releasing. Preview deployments need their own exact URLs registered. The sign-in SDK uses `https://id.teksafari.com/`, its standard `openid`, `profile`, and `offline_access` scopes, and the `email` scope required by the application session contract. Membership status and roles are read from local PostgreSQL; neither Logto organization data nor token role claims authorize site access.

For Vercel Preview deployments, set the required application credentials (`LOGTO_APP_ID`, `LOGTO_APP_SECRET`, and `LOGTO_COOKIE_SECRET`) for **all Preview branches**, along with the database setting. Management API credentials and organization role IDs are not runtime configuration. A value scoped to one branch does not configure future branches. Keep the cookie secret consistent across deployments of a branch so existing sessions remain readable.

When `VERCEL_ENV=preview` and `LOGTO_BASE_URL` is absent or empty, the application derives its origin as `https://` plus Vercel's `VERCEL_BRANCH_URL`, the stable branch alias. Vercel system environment variables must be available to the build and runtime; Turbo forwards and hashes both variables. The branch value must be a hostname without a scheme, port, path, credentials, query, fragment, or whitespace. An explicit `LOGTO_BASE_URL`, including an existing branch-specific override, takes precedence and keeps the same origin validation. Production and local development still require an explicit origin. Do not enter shell-style `$VERCEL_BRANCH_URL` interpolation as a dashboard value.

For each Preview branch, register the exact derived origin plus `/api/tekid/callback` as a Logto redirect URI and plus `/profile` as a post sign-out redirect URI. If an explicit origin is configured, register that origin instead. Open and test sign-in through that stable branch alias (or the explicit configured origin), rather than Vercel's deployment-hash URL: the sign-in cookie belongs to the host that started the flow, and returning to another host cannot read it. Origin derivation does not register callbacks or redirect visits from other deployment URLs.

The callback reconstructs its public URL from `LOGTO_BASE_URL` so it works behind Portless and deployment proxies. `GET /api/tekid/sign-in` starts sign-in with an allowlisted destination of `/profile`, `/members`, or `/admin`; visiting `/login` starts the admin tekID flow. Sign-out returns to `/profile`. The old `/test-profile` path permanently redirects to `/profile`, preserving query parameters for existing links and in-progress authentication flows.

`AuthContextType` is a discriminated union: `isAuthenticated: true` guarantees non-null `sub`, `name`, `email`, and `email_verified` in `claims`; `isAuthenticated: false` has `claims: null`. `name` is the required display name. `username` is a separate, optional identifier that can be unassigned; the application exposes it as `string | null` and never uses it as a substitute for `name`. A missing, blank, or malformed username becomes `null` without blocking sign-in. The server validates required fields once and projects only the application fields. `email_verified` must be a boolean, and `false` is valid; verification requirements are a separate authorization decision. Components can narrow with `isAuthenticated` alone to render `claims.name`. The profile page passes only name and picture to its client avatar; a missing or broken picture shows initials.

An authenticated session with missing or malformed required claims raises `TekidProfileContractError` instead of inventing profile values or reporting the user as signed out. `/profile` identifies the missing required field and links to tekID account management, with sign-in and sign-out actions. Existing sessions created before the `email` scope was added must sign in again; changing configured scopes does not update their stored ID token. If fresh sign-in still fails, check the user's required tekID profile fields and the application's scope configuration. Display names are managed under **Personal info**. An unassigned username requires no profile completion or extra sign-in; these members can view their name and photo normally.

The tekID app logo uses the dot\*WTF wordmark assets in `public/dot-wtf-wordmark.svg` and `public/dot-wtf-wordmark-dark.svg`: "dot", the orbit mark as the asterisk, then "WTF", matching the site's `Wordmark`. Both are self-contained vectors. The artwork is sized to 32px inside a transparent 40px-high canvas to fit Logto's logo slot, and the sign-in CSS sizes the logo image by its own width so it is not squeezed. Regenerate them on macOS with `swift scripts/export-wordmark.swift`. The sign-in canvas is always light, so both of Logto's light and dark app logo fields contain an SVG data URL of `public/dot-wtf-wordmark.svg`; the preview works before deploying the assets, and the navy dot keeps its colour because the CSS applies no filter. The favicon fields use `https://dott.wtf/icon.svg`. The mark's design history is in [docs/logo-explorations.md](docs/logo-explorations.md).

The dot-wtf app's **Branding → CSS overrides** in Logto contains [docs/tekid-sign-in.css](docs/tekid-sign-in.css). It uses the site's default light palette and rounded font stack, with charcoal `#1A1A1A` configured for both brand-color fields. At desktop widths, a warm-gray side panel shows the laptop cat from `https://dott.wtf/cat-pc.svg`, a vector trace of `public/cat-pc.png` that stays sharp at any size, and “create beyond the possible” At widths below 900px or heights below 560px, the decorative panel disappears so the form can use the whole screen. The illustration also shrinks with viewport height. The shared sign-in, registration, and recovery layouts retain their original controls and validation; the Google button stays above the email form. Nunito is loaded as the cross-platform fallback to SF Pro Rounded. App CSS replaces shared tekID CSS, so keep this copy in sync with the console. These settings apply only to the dot-wtf application.

`pnpm sync:logto-branding` compares the dot-wtf app's logo fields, favicons, and CSS override in Logto with the files above, and changes nothing. With `--apply`, it writes the repository's versions, leaves every other sign-in experience setting as it was, and reads them back to confirm. It needs `LOGTO_APP_ID` and the operator-only Management API credentials, `LOGTO_MANAGEMENT_APP_ID` and `LOGTO_MANAGEMENT_APP_SECRET`.

## Member applications and directory

Logto handles sign-in and identity claims. PostgreSQL owns the application, membership status, dashboard role, and unique member number. `/join` redirects to [/profile](http://dot-wtf.localhost:1355/profile); the Tally embed and both old intake routes are retired.

`users` stores the local UUID and external tekID identity. `profiles` stores editable application answers and public profile details, linked by `user_id`. `memberships` stores a separate UUID, the same `user_id`, review status, role, and the editable `member_number`. Changing a member number never changes either UUID. Authentication resolves the external subject to the local user; authorization reads their membership without depending on a profile row.

A signed-in user can save a draft profile, then submit the complete application for review. It includes their name, interests, institution and location, WhatsApp number, bio, WTF idea, current project, application video, portfolio, and optional social links. Submission requires a verified email and all required answers. Drafts and rejected applications can be edited and submitted; pending applications wait for review. Approved members can keep their profile current. A suspended profile keeps its data and number but has no member access.

The first eligible verified sign-in can copy matching historical application answers into the local profile, using the latest case-insensitive email match. This does not approve membership. The import is marked in the audit log, so later profile edits or email verification changes do not repeatedly overwrite answers. An unverified email never claims a historical application.

[/members](http://dot-wtf.localhost:1355/members) is visible only to approved local members and shows approved profiles with their member number, name, photo, bio, and social links. Emails, contact details, roles, and application answers are limited to the member and authorized dashboard reviewers. Logto organization membership no longer grants directory access.

## Local roles and dashboard access

The **Applications & members** dashboard opens on pending profiles. Reviewers read the full submitted application and approve or reject it. Approval adds the profile to the directory and assigns the next unused member number in approval order. An admin can choose a custom number, including zero, at approval or change an existing number; duplicate numbers are rejected. Automatic numbering starts at one and never rewinds after renumbering. Numbers remain attached to rejected or suspended profiles and are not automatically reused.

| Access | Approved member | `instance-lead` | `admin` |
| --- | --- | --- | --- |
| View the member directory | Yes | Yes | Yes |
| Review ordinary applicants and suspend ordinary members | No | Yes | Yes |
| Review or suspend dashboard staff | No | No | Yes |
| Assign or change member numbers | No | No | Yes |
| Assign `admin` / `instance-lead` roles to approved members | No | No | Yes |

Every protected page and API reads local membership. Membership changes share a database lock, recheck the acting user's privileges after acquiring it, and record an audit event. Administrators cannot demote or suspend themselves, and the last active administrator is protected. **Historical applications** is a separate read-only view: its old review states never grant current membership. Migration `0012_split_member_tables` preserved existing records while splitting identity, profile, and membership. PostgreSQL's `member_number_seq` allocates numbers; draft creation and reads consume none, and failed transactions can leave gaps.

Migration `0015_remove_member_compatibility` completes the transition by removing the temporary `member_profiles` view, legacy counter, and their bridges. Apply it only after the merged split-table runtime is deployed and every running version uses the canonical `users`, `profiles`, and `memberships` tables. Those tables, audit records, and `member_number_seq` remain in place. After `0015`, rolling back to pre-split code requires restoring the compatibility definitions first; a code revert alone is insufficient. See [the rollout guide](docs/local-membership-rollout.md#split-table-migration-and-compatibility).

For the initial local administrator, have the intended person sign in with a verified email and open `/profile`, then run from a trusted operator environment:

```bash
pnpm create-admin --email member@example.org --role admin --dry-run
pnpm create-admin --email member@example.org --role admin
```

Use `--user-id` instead of `--email` if email matches are ambiguous. The command accepts `--role instance-lead` and uses only `DATABASE_URL`. It requires one existing verified local profile, refuses rejected or suspended accounts and administrator demotion, preserves an existing number, and otherwise allocates one under the shared lock. This operator-only bootstrap intentionally permits an incomplete profile to become approved; routine applicants use dashboard review. Repeating an unchanged grant is a no-op. It never calls Logto or creates a password.

Before switching an existing installation, follow [the local membership rollout](docs/local-membership-rollout.md). `pnpm import:logto-members` prepares a dry-run plan of current Logto organization membership. Only `--apply` writes it to PostgreSQL, in one transaction. Prior imports and local decisions are preserved, including later revocations. Keep import-only Management API credentials in the operator environment; remove them from the deployed app after cutover.

Validate with `pnpm test:env`, `pnpm test:tekid`, `pnpm test:admin`, `pnpm test:tally`, `pnpm test:profiles`, `pnpm test:operators`, `pnpm test:member-schema`, `pnpm exec tsc --noEmit`, and `LOGTO_BASE_URL=https://dott.wtf pnpm build`. Database suites require their separate disposable fixture URLs; CI supplies all of them. Then verify tekID sign-in, reload, and sign-out; check dashboard access with an admin, an instance-lead, and an ordinary member; and confirm that a role removal applies on the next request. Integration follows the [tekID application guide](https://github.com/teKsafari/id/blob/main/docs/applications/index.md) and [Logto’s Next.js guide](https://docs.logto.io/quick-starts/next-app-router).

---

**Join us:** Visit [dott.wtf](https://dott.wtf) to get started.
