# Troubleshooting

Every entry below starts with the message you actually see.

## Startup

### `environment validation failed` / `refusing to start: missing required configuration`

The boot validator lists exactly what is missing. Common causes:

- `.env` was not loaded (you are not in the repository root, or you did not
  `cp .env.example .env`);
- `DISCORD_TOKEN` is empty;
- `BOT_OWNER_IDS` is empty or contains a non-numeric entry. The error masks the
  offending value (`11312…4336`) so a typo does not end up in a public log.

### `invalid BOT_OWNER_IDS`

Each entry must be a numeric Discord snowflake, separated by commas. Quotes,
spaces around the whole list and trailing commas are fine; letters are not.

### `database unreachable in production - aborting`

Production refuses to run without a database. Check `DATABASE_URL`, the
`DATABASE_SSL` flag (managed providers usually need `true`), and that the host
allows connections from this machine. Outside production the bot logs a warning
and continues without persistence, which means economy, warns and settings will
not be saved.

### `DATABASE_URL is required in production`

Set it. `ALLOW_NO_DATABASE` is a development escape hatch and is rejected in
production by design.

### Migration `checksum mismatch`

Someone edited a migration that has already been applied. Do not "fix" the row in
`schema_migrations`; write a new migration file with the change. `npm run
migrate:status` shows which file drifted.

## Commands

### Commands do not appear in Discord

1. Did you run `npm run deploy-commands` after changing them?
2. `DISCORD_DEV_GUILD_ID` set → guild-scoped, appears in seconds, **only in that
   server**. Unset → global, and Discord can take up to an hour.
3. The bot needs the `applications.commands` scope in its invite URL.
4. Re-invite the bot if you added permissions after the first invite.

### `The bot is missing permission(s): …`

The command checked the bot's own permissions first, so this is about the bot's
role, not yours. Move the bot's role above the target role and grant the listed
permission.

### `You need: …`

You lack the listed Discord permission in that server.

### `This command is restricted to server staff.`

`/config staff-role` or `/security trust` can grant access, as can Manage Server
or Ban Members.

### `That command is on cooldown`

Per user, per command, per server. The message includes how long is left.
Owners can clear it with `/config` tooling or by restarting (cooldowns are
in-memory unless `REDIS_URL` is set).

## Economy

### `Not enough funds for that operation.`

Transfers and withdrawals use **wallet** funds only; the bank is not tapped
automatically. Use `/economy withdraw` first.

### `That operation was already completed.`

The transfer carried an idempotency key that was already used. This is the guard
that stops a double-click from paying twice — it is working as intended.

### Balances reset / not saving

The database is not connected. Check for the `running without persistence`
warning in the logs.

## Security

### Anti-raid locked the server during a genuine event

`/security lockdown off` releases it. Then raise `join_threshold` or widen
`join_window_ms` for the duration of the event, and consider
`/security trust add` for the staff who need to act.

### `/no-tag` did not delete a message

- The bot needs **Manage Messages** in that channel.
- Discord has no pre-send hook: the mention was already delivered. The bot acts
  after the message exists.
- The author was a bot, a staff member, or on the exemption list — check
  `/notag violations` and `/notag status`.

### `/no-pin` says `unknown` for who pinned

Attribution comes from the audit log. When the bot cannot read it, or the entry
has aged out, the record honestly says `unknown` rather than guessing.

## Music

### `/music` says the subsystem is disabled

`MUSIC_ENABLED=false` (the default). Enable it and configure `LAVALINK_*`.

### `Lavalink node unreachable`

Check the host/port/password, and that the node's `application.yml` password
matches `LAVALINK_PASSWORD`. `/health` shows the node status; when there is no
node it reports `unknown`, not `ok`.

### A Spotify link plays a different recording

By design. Spotify links are resolved to **track names**, which are then searched
on a permitted audio source. Spotify audio is never streamed.

## Dashboard

### `Sign in to continue.` loop

- `SESSION_SECRET` must be at least 32 characters.
- `DASHBOARD_URL` must match the origin you are browsing, including the scheme.
- Behind a proxy, forward `X-Forwarded-Proto` so cookies are marked `secure`.

### `error=state_mismatch` after logging in

The OAuth `state` cookie did not survive the redirect. Causes: cookies blocked,
the redirect URI in Discord differing from `DISCORD_REDIRECT_URI`, or logging in
from two tabs at once. Retry from `/login`.

### `That server is not visible to your account.` / `You need Manage Server permission in that server.`

`assertGuildManager` re-checked your permissions against Discord and you are not
a manager of that guild. Only servers you can manage are listed on `/dashboard`.

### `Settings group "x" is not writable from the dashboard.`

`branding`, `no_tag` and `no_pin` are intentionally not editable from the web UI.
Use the Discord commands.

### The owner panel says metrics are unavailable

Expected when `BOT_API_ENABLED` is off. Set `BOT_API_ENABLED=true` and an
identical `BOT_API_TOKEN` on both sides, plus `BOT_API_URL` (e.g.
`http://bot:8787`) when the bot runs in another container. The panel never
estimates a value it cannot fetch.

### Configuration banner on `/`

Required variables are missing: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`DISCORD_REDIRECT_URI`, `SESSION_SECRET`, `DATABASE_URL`. The banner lists which.

## Tests and CI

### `npm test` skips two tests locally

Those two exercise JSONB concatenation, which `pg-mem` does not implement. They
are gated on `USES_REAL_POSTGRES` and run in CI's PostgreSQL job. They are
reported as **skipped**, never as passing.

### `npm audit` fails in CI

`node scripts/audit.mjs` prints the blocking advisories. Either fix them or, after
review, add the package to the allowlist in that file **with a written reason**
and update `docs/SECURITY.md`.

### `docs/COMMANDS.md` drift check fails in CI

Run `npm run docs:commands` and commit the result. The file is generated from the
live registry; editing it by hand is what causes the drift.

## Where to look next

| Symptom                  | File                                            |
| ------------------------ | ----------------------------------------------- |
| Command access decisions | `apps/bot/src/commands/registry.ts`             |
| Detection thresholds     | `apps/bot/src/security/thresholds.ts`           |
| Money invariants         | `packages/database/src/repositories/economy.ts` |
| Migration runner         | `packages/database/src/migrate.ts`              |
| Dashboard authorization  | `apps/dashboard/lib/authorization.ts`           |
| Settings write policy    | `apps/dashboard/lib/settingsPolicy.ts`          |
| Bot metrics API          | `apps/bot/src/api/server.ts`                    |
