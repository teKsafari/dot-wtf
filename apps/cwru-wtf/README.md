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

## tekID profiles

[/test-profile](http://dot-wtf.localhost:1355/test-profile) starts a tekID sign-in or account creation flow and returns to a minimal name/photo profile. tekID owns the member’s identity and profile; this initial integration does not need a local member table. The existing NextAuth admin login remains separate.

Use the **dot-wtf** Traditional web application in the tekID Logto console. Copy `LOGTO_APP_ID` and `LOGTO_APP_SECRET` into `.env.local`, set `LOGTO_BASE_URL`, and generate a separate `LOGTO_COOKIE_SECRET` of at least 32 characters (`openssl rand -hex 32`). These values are server-only; never prefix them with `NEXT_PUBLIC_` or commit secrets.

Register these exact URLs in that application:

| Environment | Redirect URI | Post sign-out redirect URI |
| --- | --- | --- |
| Local | `http://dot-wtf.localhost:1355/api/tekid/callback` | `http://dot-wtf.localhost:1355/test-profile` |
| Production | `https://cwru.wtf/api/tekid/callback` | `https://cwru.wtf/test-profile` |

Set `LOGTO_BASE_URL=https://cwru.wtf` and all four environment variables in the production deployment before releasing. Preview deployments need their own exact URLs registered. The SDK uses `https://id.teksafari.org/` and its standard `openid`, `profile`, and `offline_access` scopes; no member email or admin roles are requested.

The callback reconstructs its public URL from `LOGTO_BASE_URL` so it works behind Portless and deployment proxies. Both sign-in and sign-out return only to `/test-profile`. Name and picture are read on the server; missing names use a fallback and missing or broken pictures show initials.

The tekID app logo uses the shared symbol-and-`wtf` wordmark assets in `public/dot-wtf-wordmark.svg` and `public/dot-wtf-wordmark-dark.svg`. Both are self-contained vectors without an entity prefix, ready for any `<entity-name>.wtf` app. The artwork is sized to 32px inside a transparent 40px-high canvas to fit Logto's logo slot. Regenerate them on macOS with `swift scripts/export-wordmark.swift`. Logto's light/dark app logo fields contain SVG data URLs from these files, so the preview works before deploying the assets. The favicon fields use `https://cwru.wtf/icon.svg`.

The dot-wtf app's **Branding → CSS overrides** in Logto contains [docs/tekid-sign-in.css](docs/tekid-sign-in.css). It uses `https://cwru.wtf/bgbg.jpg` as a centered, cover-sized background with a subtle dark overlay. App CSS replaces the shared tekID CSS, so the file includes the existing form styling before the background rule. Keep this copy in sync if the shared form styling changes; update the image URL here for another entity's background.

Validate with `pnpm test:tekid`, `pnpm exec tsc --noEmit`, and `pnpm build`, then test sign-in, reload, and sign-out at the local profile URL. Integration follows the [tekID application guide](https://github.com/teKsafari/id/blob/main/docs/applications/index.md) and [Logto’s Next.js guide](https://docs.logto.io/quick-starts/next-app-router).

---

**Join us:** Visit [cwru.wtf](https://cwru.wtf) to get started.
