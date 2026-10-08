# Deployment

## Prerequisites

- Node.js **20.11 or newer** (CI and the container images use Node 22)
- PostgreSQL **14 or newer**
- A Discord application with a bot token
- Optional: a Lavalink v4 node for music, Redis for a shared cache

## 1. Discord application setup

1. Create an application at <https://discord.com/developers/applications>.
2. **Bot** → reset the token → put it in `DISCORD_TOKEN`.
3. Enable the **privileged gateway intents** the bot requests:
   - `GUILD_MEMBERS` (welcome messages, autorole, verification, member counts)
   - `MESSAGE_CONTENT` (anti-spam, AutoMod, custom commands, starboard)
4. **OAuth2** → add a redirect URI matching `DISCORD_REDIRECT_URI` exactly, e.g.
   `https://dash.example.com/api/auth/callback`.
5. Copy the **Client ID** into `DISCORD_CLIENT_ID` and the **client secret** into
   `DISCORD_CLIENT_SECRET`.

### Bot permissions

Invite the bot with the scopes `bot applications.commands` and these permissions:

| Permission                                                      | Needed for                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| View Channels, Send Messages, Embed Links, Read Message History | Everything                                                        |
| Manage Messages                                                 | purge, no-tag deletion, no-pin unpin, starboard, AutoMod          |
| Manage Roles                                                    | autorole, reaction roles, anti-nuke role stripping, level rewards |
| Manage Channels                                                 | lockdown, ticket channels                                         |
| Kick Members, Ban Members, Moderate Members                     | moderation commands                                               |
| Manage Nicknames                                                | `/nickname`                                                       |
| Manage Webhooks                                                 | logging via webhooks (optional)                                   |
| Manage Threads                                                  | thread-based tickets (optional)                                   |
| Add Reactions, Use External Emojis                              | reaction roles, starboard                                         |
| Connect, Speak                                                  | music                                                             |
| View Audit Log                                                  | anti-nuke and no-pin attribution                                  |
| Mention Everyone                                                | `/announce` (optional)                                            |

The bot must be ranked **above** every role it is expected to moderate; Discord
refuses to act on members whose highest role is at or above the bot's, and
`canModerateTarget` mirrors that rule so the command explains it instead of
returning Discord's error 50013.

## 2. Configuration

```bash
cp .env.example .env
```

| Variable                                                              | Required            | Notes                                                           |
| --------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| `DISCORD_TOKEN`                                                       | yes                 | The one and only token variable name                            |
| `DISCORD_CLIENT_ID`                                                   | yes                 | Application ID                                                  |
| `BOT_OWNER_IDS`                                                       | yes                 | `1131248987173814336,1473315482554732786` by default            |
| `DISCORD_DEV_GUILD_ID`                                                | no                  | Set during development for instant command registration         |
| `DATABASE_URL`                                                        | yes                 | PostgreSQL only                                                 |
| `DATABASE_SSL`                                                        | no                  | `true` for managed providers                                    |
| `DATABASE_POOL_MAX`                                                   | no                  | Default 10                                                      |
| `MIGRATIONS_DIR`                                                      | no                  | Default `./database/migrations`                                 |
| `DISCORD_CLIENT_SECRET`                                               | dashboard           | OAuth2 secret                                                   |
| `DISCORD_REDIRECT_URI`                                                | dashboard           | Must match the Discord application exactly                      |
| `DASHBOARD_URL`                                                       | dashboard           | Public base URL, used for redirects and cookies                 |
| `SESSION_SECRET`                                                      | dashboard           | 32+ random characters                                           |
| `BOT_API_ENABLED` / `BOT_API_HOST` / `BOT_API_PORT` / `BOT_API_TOKEN` | no                  | Bot metrics API for the owner panel                             |
| `BOT_API_URL`                                                         | no                  | Set on the dashboard when the bot is on another host            |
| `REDIS_URL`                                                           | no                  | Shared cache/locks for multi-process deployments                |
| `MUSIC_ENABLED`, `LAVALINK_*`, `SPOTIFY_*`                            | no                  | Music is off unless enabled                                     |
| `ALLOW_NO_DATABASE`                                                   | never in production | Local smoke tests only; production refuses to start with it set |

`.env` is git-ignored. Never commit real values.

## 3. Docker Compose (recommended)

```bash
cp .env.example .env      # set POSTGRES_PASSWORD, DISCORD_TOKEN, secrets
docker compose up -d --build
docker compose run --rm bot npm run deploy-commands   # once, after config changes
docker compose logs -f bot dashboard
```

Services:

| Service     | Notes                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `postgres`  | PostgreSQL 16, healthchecked, data in the `pgdata` volume, port bound to `127.0.0.1` only          |
| `bot`       | runs `npm run migrate && npm run bot`, so the schema is always current before the gateway connects |
| `dashboard` | Next standalone build on `${DASHBOARD_PORT:-3000}`                                                 |
| `redis`     | `--profile cache`                                                                                  |
| `lavalink`  | `--profile music`, requires `LAVALINK_PASSWORD`                                                    |

`POSTGRES_PASSWORD` is mandatory: compose refuses to start without it.

### Building images directly

```bash
docker build --target bot       -t dcbot-bot .
docker build --target dashboard -t dcbot-dashboard .
```

Both images run as a non-root `dcbot` user. The bot image runs the command smoke
test during the build, so a broken command set fails the build rather than the
deployment.

**Note on the bot image:** it runs the TypeScript sources through `tsx`, the same
execution path used by `npm run bot`, `npm run verify:commands` and the test
suite. Nothing is compiled to `dist` for the container, because the workspace
packages resolve their entry points to `src/*.ts`. If you need a compiled image,
point each workspace's `main`/`exports` at `dist` and switch the `CMD` to
`node apps/bot/dist/index.js`.

## 4. Bare metal / VM

```bash
npm ci
npm run migrate
npm run deploy-commands
npm run bot            # or: pm2 start "npm run bot" --name dcbot
npm run dashboard:build && npm run start:dashboard
```

Put the dashboard behind a TLS-terminating proxy: session cookies are only marked
`secure` when `NODE_ENV=production`, and Discord requires HTTPS for OAuth
redirects in production.

## 5. Command registration

```bash
npm run deploy-commands
```

- With `DISCORD_DEV_GUILD_ID` set, commands are registered to that guild
  (near-instant, ideal while developing).
- Without it, commands are registered **globally**; Discord can take up to an
  hour to propagate global commands.
- The script validates names, description lengths and option counts against
  Discord's documented limits **before** sending anything, and fails on a
  duplicate name or an oversized payload.

Guild-level custom commands created with `/globalcommand scope:guild` are
registered per guild and are editable in Discord's own Server Settings →
Integrations UI; global ones are managed by the bot only.

## 6. Music (optional)

1. Run a Lavalink v4 node (`docker compose --profile music up -d`).
2. Set `MUSIC_ENABLED=true`, `LAVALINK_HOST`, `LAVALINK_PORT`,
   `LAVALINK_PASSWORD`.
3. Optional: `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` resolve Spotify links
   to **track names**, which are then searched on a permitted audio source.
   Spotify audio is never streamed.

Without a node the bot reports the music service as `unknown` in `/health` and
`/music` explains that music is disabled. It never claims to be playing.

## 7. Health and monitoring

| Endpoint       | Auth         | Returns                                                                  |
| -------------- | ------------ | ------------------------------------------------------------------------ |
| `GET /healthz` | none         | `{ ok: true, uptimeMs }` — liveness only                                 |
| `GET /health`  | bearer token | service health, uptime, gateway ping, cache sizes                        |
| `GET /metrics` | bearer token | process memory/CPU, gateway, commands, log counters, 24h security events |

The bot's own `/health` command shows the same information in Discord. Every
subsystem that is not configured reports `unknown` with a reason.

## 8. Upgrade checklist

1. `git pull`
2. `npm ci`
3. `npm run migrate` (additive migrations only — never edit an applied file)
4. `npm run deploy-commands` if any command changed
5. `docker compose up -d --build` (or restart the processes)
6. Check `/healthz`, then `/health` with the token
