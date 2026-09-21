# cwru.wtf website

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)

> A student-led collective for builders, tinkerers, and dreamers at Case Western Reserve University.

## What is cwru.wtf?

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
pnpm db:push
```

Open [http://dot-wtf.localhost:1355](http://dot-wtf.localhost:1355). Portless manages the app’s internal port.

Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and all nine `LOGTO_*` values before starting or building. [`env.ts`](env.ts) exposes the typed configuration, validated with `@t3-oss/env-core` and Zod. Application code imports `env` instead of reading `process.env`; the schema lives in [`lib/env-schema.ts`](lib/env-schema.ts). Next.js loads `.env` files, and CLI entry points that import application modules use `scripts/load-env.ts`. The environment module does not load files.

`next.config.mjs` imports the validation before development, build, and server startup, so invalid required settings stop the command with the variable names. Tally settings remain optional; the webhook returns 503 when they are not configured. Turbo forwards and hashes the required Logto variables for builds. `LOGTO_BASE_URL` is the application's HTTP(S) origin and must use HTTPS for a production build. To verify a production build locally, run `LOGTO_BASE_URL=https://cwru.wtf pnpm build`; keep the local `.env.local` origin set to Portless for development.

## tekID profiles

[/profile](http://dot-wtf.localhost:1355/profile) starts a tekID sign-in or account creation flow and returns to a minimal name/photo profile. tekID owns the member’s identity and profile. [/admin](http://dot-wtf.localhost:1355/admin) uses the same tekID session; there is no separate admin password or login form. Organization membership and roles determine dashboard access.

Use the **dot-wtf** Traditional web application in the tekID Logto console. Copy `LOGTO_APP_ID` and `LOGTO_APP_SECRET` into `.env.local`, set `LOGTO_BASE_URL`, and generate a separate `LOGTO_COOKIE_SECRET` of at least 32 characters (`openssl rand -hex 32`). These values are server-only; never prefix them with `NEXT_PUBLIC_` or commit secrets.

Register these exact URLs in that application:

| Environment | Redirect URI | Post sign-out redirect URI |
| --- | --- | --- |
| Local | `http://dot-wtf.localhost:1355/api/tekid/callback` | `http://dot-wtf.localhost:1355/profile` |
| Production | `https://cwru.wtf/api/tekid/callback` | `https://cwru.wtf/profile` |

Set `LOGTO_BASE_URL=https://cwru.wtf` and all nine Logto environment variables in the production deployment before releasing. Preview deployments need their own exact URLs registered. The sign-in SDK uses `https://id.teksafari.org/`, its standard `openid`, `profile`, and `offline_access` scopes, and the `email` scope required by the application session contract. Organization roles are read through the Management API rather than copied from ID-token claims.

The callback reconstructs its public URL from `LOGTO_BASE_URL` so it works behind Portless and deployment proxies. `GET /api/tekid/sign-in` starts sign-in with an allowlisted destination of `/profile` or `/admin`; visiting `/login` starts the admin tekID flow. Sign-out returns to `/profile`. The old `/test-profile` path permanently redirects to `/profile`, preserving query parameters for existing links and in-progress authentication flows.

`AuthContextType` is a discriminated union: `isAuthenticated: true` guarantees non-null `sub`, `name`, `email`, and `email_verified` in `claims`; `isAuthenticated: false` has `claims: null`. `name` is the required display name. `username` is a separate, optional identifier that can be unassigned; the application exposes it as `string | null` and never uses it as a substitute for `name`. A missing, blank, or malformed username becomes `null` without blocking sign-in. The server validates required fields once and projects only the application fields. `email_verified` must be a boolean, and `false` is valid; verification requirements are a separate authorization decision. Components can narrow with `isAuthenticated` alone to render `claims.name`. The profile page passes only name and picture to its client avatar; a missing or broken picture shows initials.

An authenticated session with missing or malformed required claims raises `TekidProfileContractError` instead of inventing profile values or reporting the user as signed out. `/profile` identifies the missing required field and links to tekID account management, with sign-in and sign-out actions. Existing sessions created before the `email` scope was added must sign in again; changing configured scopes does not update their stored ID token. If fresh sign-in still fails, check the user's required tekID profile fields and the application's scope configuration. Display names are managed under **Personal info**. An unassigned username requires no profile completion or extra sign-in; these members can view their name and photo normally.

The tekID app logo uses the shared symbol-and-`wtf` wordmark assets in `public/dot-wtf-wordmark.svg` and `public/dot-wtf-wordmark-dark.svg`. Both are self-contained vectors without an entity prefix, ready for any `<entity-name>.wtf` app. The artwork is sized to 32px inside a transparent 40px-high canvas to fit Logto's logo slot. Regenerate them on macOS with `swift scripts/export-wordmark.swift`. Logto's light/dark app logo fields contain SVG data URLs from these files, so the preview works before deploying the assets. The favicon fields use `https://cwru.wtf/icon.svg`.

The dot-wtf app's **Branding → CSS overrides** in Logto contains [docs/tekid-sign-in.css](docs/tekid-sign-in.css). It uses `https://cwru.wtf/bgbg.jpg` as a centered, cover-sized background with a subtle dark overlay. App CSS replaces the shared tekID CSS, so the file includes the existing form styling before the background rule. Keep this copy in sync if the shared form styling changes; update the image URL here for another entity's background.

## Organization roles and dashboard access

Each deployed entity site uses its own Logto organization, selected by `LOGTO_ORGANIZATION_ID`. Create two **User organization roles** in Logto's organization template: `admin` and `instance-lead`. Assignments belong to a specific organization; an admin of another entity does not gain access to this site's dashboard. The role IDs are configuration, and roles are not inferred from a user's email, name, or optional username.

| Access | Ordinary member | `instance-lead` | `admin` |
| --- | --- | --- | --- |
| View their own profile | Yes | Yes | Yes |
| Open dashboard and manage submissions | No | Yes | Yes |
| View members and add existing tekID users as ordinary members | No | Yes | Yes |
| Assign or remove `admin` / `instance-lead` roles | No | No | Yes |

An ordinary member has organization membership without either privileged role; no separate `member` role is needed. A tekID user can view `/profile` before being added to the organization. Dashboard role changes affect only the two configured roles within this site's organization.

Give both organization roles the permissions `dashboard:access`, `submissions:read`, `submissions:manage`, `members:read`, and `members:invite`. Give only `admin` the additional permission `members:assign-roles`. These are organization permissions in Logto's organization template. The app requires the configured role ID and the permission for the requested action; it never allows an instance-lead to assign roles even if that permission is accidentally added to the role in Logto.

Configure a separate **Machine-to-machine application** with access to the Logto Management API, and set `LOGTO_MANAGEMENT_APP_ID` and `LOGTO_MANAGEMENT_APP_SECRET`. Set `LOGTO_ADMIN_ROLE_ID` and `LOGTO_INSTANCE_LEAD_ROLE_ID` to the distinct IDs of the corresponding User organization roles. These are different credentials from the Traditional web application's `LOGTO_APP_ID` and `LOGTO_APP_SECRET`. The official `@logto/api` SDK obtains and refreshes the management token for the self-hosted API resource `https://default.logto.app/api`. See [Logto Management API setup](https://docs.logto.io/integrate-logto/interact-with-management-api).

Dashboard pages and every admin API authorize the acting tekID user on the server using current organization roles, permissions, and account suspension state from Logto. The Management API check is not cached across requests, so removing a role takes effect on the next protected request without requiring a new sign-in. A failed role lookup does not grant access. The previous NextAuth credentials flow and `AUTH_SECRET` configuration are no longer used; existing password-based admin records do not grant tekID access.

The **Members** dashboard adds an existing tekID account using an exact primary-email match. Someone without an account must register through tekID first. This implementation does not create pending invitations or send invitation emails. An instance-lead can add ordinary members; only an admin can choose or change privileged roles. User IDs from the matched account identify subsequent role assignments. An admin cannot remove their own admin role, and removing another admin requires another active admin to remain. Member changes are serialized through a database lock and recheck the acting user's access after acquiring it. Unrelated organization roles are preserved.

Bootstrap the first administrator from a trusted terminal after configuring the organization and role IDs:

```bash
pnpm create-admin --email member@example.org --role admin
```

The same command accepts `--role instance-lead`. It requires a unique existing primary-email match, rejects suspended accounts, verifies the selected role, and adds membership and that role without replacing existing assignments. It reads back the assignment before reporting success. Rerunning is safe: Logto ignores memberships and role assignments already present. It never creates local passwords. This command uses the management credential directly and is intended for trusted operators; routine changes use the dashboard's admin-only role checks.

Validate with `pnpm test:env`, `pnpm test:tekid`, `pnpm test:admin`, `pnpm test:tally`, `pnpm exec tsc --noEmit`, and `LOGTO_BASE_URL=https://cwru.wtf pnpm build`. Then verify tekID sign-in, reload, and sign-out; check dashboard access with an admin, an instance-lead, and an ordinary member; and confirm that a role removal applies on the next request. Integration follows the [tekID application guide](https://github.com/teKsafari/id/blob/main/docs/applications/index.md) and [Logto’s Next.js guide](https://docs.logto.io/quick-starts/next-app-router).

---

**Join us:** Visit [cwru.wtf](https://cwru.wtf) to get started.
