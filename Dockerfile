# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# Multi-stage image for both Dcbot services.
#
#   docker build --target bot       -t dcbot-bot .
#   docker build --target dashboard -t dcbot-dashboard .
#
# The bot runs its TypeScript sources through tsx (the same path used by
# `npm run bot` and `npm run verify:commands`), so the container executes exactly
# the code the repository tests execute. The dashboard is a real production
# build: `next build` with `output: 'standalone'`.
# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# Dependency layer: only the manifests change between most builds.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY apps/bot/package.json apps/bot/
COPY apps/dashboard/package.json apps/dashboard/

# -----------------------------------------------------------------------------
# Bot image
# -----------------------------------------------------------------------------
FROM base AS bot-deps
# tsx is a devDependency and is required at runtime for this image.
RUN npm ci --include=dev

FROM bot-deps AS bot-src
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/bot ./apps/bot
COPY database ./database
COPY scripts ./scripts
# The bot validates the command set before it ever connects to Discord.
RUN npx tsx scripts/smoke-commands.ts

FROM node:22-bookworm-slim AS bot
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 dcbot \
    && useradd --system --uid 1001 --gid dcbot --home /app dcbot
COPY --from=bot-src --chown=dcbot:dcbot /app /app
USER dcbot
# Command registration is an explicit, separate step: `docker compose run --rm bot
# npm run deploy-commands`.
CMD ["npm", "run", "bot"]

# -----------------------------------------------------------------------------
# Dashboard image
# -----------------------------------------------------------------------------
FROM base AS dashboard-build
RUN npm ci --include=dev
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run dashboard:build

FROM node:22-bookworm-slim AS dashboard
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 1001 dcbot \
    && useradd --system --uid 1001 --gid dcbot --home /app dcbot
# `output: 'standalone'` produces a self-contained server with only the modules
# it actually uses.
COPY --from=dashboard-build --chown=dcbot:dcbot /app/apps/dashboard/.next/standalone ./
COPY --from=dashboard-build --chown=dcbot:dcbot /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=dashboard-build --chown=dcbot:dcbot /app/apps/dashboard/public ./apps/dashboard/public
USER dcbot
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
