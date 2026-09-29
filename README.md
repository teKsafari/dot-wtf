# Homebase

Homebase is the monorepo behind dot WTF, a student-led collective for people who build bold, weird, useful things. The site is served at [cwru.wtf](https://cwru.wtf) for now.

The spirit is simple: less talking, more shipping. Projects span hardware, software, games, art, AI, and experiments that feel a little impossible until someone builds them.

## What lives here

- [apps/cwru-wtf](apps/cwru-wtf): Main dot WTF site and platform.
- [apps/cwru-wordle](apps/cwru-wordle): CWRU-themed Wordle game.
- [apps/cwru-unblock](apps/cwru-unblock): Unblock game app.
- [apps/cwru-unblock-api](apps/cwru-unblock-api): API for Unblock.
- [packages](packages): Shared internal configs and libraries used by apps.

## Build system (high level)

- Package manager: pnpm workspaces
- Task orchestration and caching: Turborepo
- Language/tooling: TypeScript + Prettier
- Runtime baseline: Node.js 18+

## Common commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm check-types
```

Run a single app with a filter:

```sh
pnpm dev --filter=cwru-wtf
```

## Notes

- Environment variables like DATABASE_URL, JWT_SECRET, and AUTH_SECRET are used by relevant apps.
- For app-specific setup, routes, and deployment details, use each app's local README.
