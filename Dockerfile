# syntax=docker/dockerfile:1

# dot*WTF site (apps/cwru-wtf). Built for a container host; Vercel ignores this file.
FROM node:22.23.4-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# next.config.mjs validates the environment before it builds, and nothing in the build
# opens a socket: every page that reads the database or a session is server-rendered on
# demand. So the build runs on placeholders and the real values arrive at runtime.
ENV NODE_ENV=production \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    LOGTO_APP_ID=build-placeholder \
    LOGTO_APP_SECRET=build-placeholder \
    LOGTO_BASE_URL=https://build.invalid \
    LOGTO_COOKIE_SECRET=0000000000000000000000000000000000000000000000000000000000000000
RUN pnpm --filter cwru-wtf build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app /app
WORKDIR /app/apps/cwru-wtf
EXPOSE 3000
# drizzle-kit applies only the migrations missing from its journal table, so starting an
# unchanged release is a no-op and a restarted container never re-runs a migration.
CMD ["sh", "-c", "pnpm db:migrate && exec pnpm start"]
