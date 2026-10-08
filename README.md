# Dcbot

A production-oriented Discord bot **and** its web dashboard, in one TypeScript
monorepo. Modular slash commands, a PostgreSQL-backed persistence layer with
real transactions, moderation and security automation, a virtual economy, and a
responsive Next.js dashboard with Discord OAuth2 and server-side authorization.

- **Bot:** Node 20+, TypeScript (strict), [discord.js](https://discord.js.org/) v14, 53 slash commands
- **Dashboard:** Next.js 14 App Router, React, TypeScript, dark mode, responsive
- **Database:** PostgreSQL only — no MongoDB anywhere in this repository
- **Music:** optional Lavalink v4 backend
- **Tests:** 144 passing (19 files), including repository tests that run real SQL

> Nothing in this README is aspirational. Anything not implemented is labelled as
> such, and the docs state plainly what Discord does not allow the bot to do.

---

## Quick start

```bash
git clone https://github.com/Tanveer9830/Dcbot.git
cd Dcbot
npm ci
cp .env.example .env       # fill in DISCORD_TOKEN, DATABASE_URL, secrets

npm run migrate            # create the schema
npm run verify:commands    # smoke-test the command catalog (no token needed)
npm run deploy-commands    # register the slash commands with Discord
npm run bot                # start the bot
npm run dashboard          # http://localhost:3000
```

Or with Docker:

```bash
docker compose up -d --build
docker compose run --rm bot npm run deploy-commands
```

Full instructions, required intents and the permission list are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## What is in the box

| Area                | Highlights                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moderation**      | `/ban`, `/kick`, `/timeout`, `/unban`, `/warn`, `/warnings`, `/cases`, `/purge`, `/lock`, `/slowmode`, `/nickname` — every action records a sequential case, writes a log entry, and checks Discord's role hierarchy _before_ calling the API |
| **Security**        | anti-nuke, anti-raid, anti-spam, mass-mention/caps/repeat detection, mass ban/kick detection, dangerous-permission-change detection, trusted users and roles, channel lockdown, audit-log-backed attribution                                  |
| **`/no-tag`**       | per-user mention protection with log/delete/warn/timeout modes and exemptions — with the Discord API limits documented, not glossed over                                                                                                      |
| **`/no-pin`**       | pin monitoring with audit-log attribution, optional unpin, and an honest `unknown` actor when attribution is impossible                                                                                                                       |
| **AutoMod**         | Discord AutoMod rule management plus the bot's own filters                                                                                                                                                                                    |
| **Economy**         | wallet/bank, daily/weekly/work, transfers, shop, inventory, quests, achievements, leaderboards — all inside database transactions with idempotency keys                                                                                       |
| **Leveling**        | XP with per-user cooldowns, `100·N²` curve, level role rewards, leaderboards                                                                                                                                                                  |
| **Community**       | giveaways, polls, suggestions, starboard, birthdays, reminders, reaction roles                                                                                                                                                                |
| **Tickets**         | ticket channels, transcripts, claim/close                                                                                                                                                                                                     |
| **Utility**         | `/help`, `/ping`, `/serverinfo`, `/userinfo`, `/avatar`, `/calculator`, `/timestamp`, `/embed`, `/announce`, `/poll`, `/reminder` …                                                                                                           |
| **Custom commands** | global and per-guild, owner-managed, template variables, **no code execution**                                                                                                                                                                |
| **Dashboard**       | server selection from your manageable guilds, ten settings pages, audit view, and an owner panel with live process metrics                                                                                                                    |

The complete, generated command reference — descriptions, options, access level
and cooldown for all 53 commands — is in [`docs/COMMANDS.md`](docs/COMMANDS.md).
It is produced from the live registry by `npm run docs:commands`, so it cannot
drift from the code.

## Owner access

Bot ownership comes **only** from `BOT_OWNER_IDS`
(`1131248987173814336,1473315482554732786` by default — both IDs have identical
privileges). `OwnerPolicy` is the single place that decision is made:

- a guild **Administrator is never a bot owner**;
- an empty owner list fails at boot rather than failing open;
- an invalid entry throws with the value masked.

Owner-only commands: `/globalcommand`, `/branding`, `/guilds`, `/health`.
There are no hidden admin accounts, backdoors or secret commands.

## Repository layout

```
packages/shared      errors, permissions, authorization, templates, leveling maths, validation
packages/config      zod-validated environment (one token name: DISCORD_TOKEN)
packages/database    pg pool, migration runner, 12 repositories
apps/bot             commands, events, services, security, music, automation, metrics API
apps/dashboard       Next.js App Router UI and API routes
database/migrations  0001_core.sql … 0005_dashboard.sql (36 tables)
scripts/             migrate, command smoke test, docs generator, audit gate
tests/               19 vitest files: shared, repositories, bot, dashboard
docs/                COMMANDS, DATABASE, SECURITY, DASHBOARD, DEPLOYMENT, TROUBLESHOOTING
```

## Scripts

| Command                              | What it does                                                                |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `npm run bot`                        | Start the bot                                                               |
| `npm run dashboard`                  | Start the dashboard in dev mode                                             |
| `npm run dashboard:build`            | Production build (23 routes)                                                |
| `npm run migrate` / `migrate:status` | Apply migrations / show state                                               |
| `npm run deploy-commands`            | Register slash commands (guild-scoped when `DISCORD_DEV_GUILD_ID` is set)   |
| `npm run verify:commands`            | Boot the real discovery + registration path and fail on any limit violation |
| `npm run docs:commands`              | Regenerate `docs/COMMANDS.md` from the live registry                        |
| `npm test`                           | Unit + repository tests                                                     |
| `npm run lint` / `npm run typecheck` | ESLint (zero warnings) and TypeScript strict                                |

## Testing

```bash
npm test                                        # in-memory PostgreSQL (pg-mem)
TEST_DATABASE_URL=postgres://… npm test         # real PostgreSQL: runs everything
```

The repository tests execute **real SQL** against a database with all migrations
applied. They cover the invariants that matter: guarded balance updates, the
money conservation property across a batch of transfers, idempotent retries,
cooldown races, per-guild case numbering, level-curve boundaries, migration
idempotency and checksum drift, the command authorization gates, and the
dashboard's settings write policy.

Two tests need JSONB concatenation, which `pg-mem` does not implement. They are
gated on a real PostgreSQL connection: they run in CI and are reported as
**skipped** locally — never as passing. `tests/helpers/db.ts` documents every
emulator gap it works around.

## Security

Read [`docs/SECURITY.md`](docs/SECURITY.md). Headlines:

- no `eval`, `Function` or `vm` anywhere — the calculator is a hand-written
  parser and templates are a single-pass allowlisted substitution;
- secrets are redacted from logs, database errors are re-wrapped, IPs are stored
  hashed, and dashboard tokens are stored hashed inside an encrypted cookie;
- every dashboard mutation is authorized server-side against Discord's API, not
  against a client-supplied permission value;
- the bot's metrics API requires a bearer token and refuses to start without one;
- CI runs an audit gate that fails on any high/critical advisory not explicitly
  allowlisted with a written reason.

## What this project does not do

- **No MongoDB.** PostgreSQL is the only supported database.
- **No fabricated data.** Unavailable metrics are labelled unavailable; a deleted
  message whose content was not cached is logged as such; an unattributable pin
  says `unknown`.
- **No false blocking claims.** `/no-tag` and `/no-pin` cannot intercept an
  action before Discord performs it, and the code and docs say so.
- **No Spotify audio streaming.** Spotify links resolve to track names, which are
  searched on a permitted audio source.
- **No placeholder commands.** Every registered command is implemented; the
  catalog is 53 commands, well inside Discord's limit of 100, because that is how
  many real ones there are.

## Documentation

| Document                                           | Contents                                                    |
| -------------------------------------------------- | ----------------------------------------------------------- |
| [docs/COMMANDS.md](docs/COMMANDS.md)               | Generated reference for all 53 commands                     |
| [docs/DATABASE.md](docs/DATABASE.md)               | Schema, migrations, transactions, invariants, retention     |
| [docs/SECURITY.md](docs/SECURITY.md)               | Authorization model, protections, limits, dependency policy |
| [docs/DASHBOARD.md](docs/DASHBOARD.md)             | Routes, OAuth flow, settings policy                         |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)           | Environment, Docker, bare metal, intents, permissions       |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Every error message, what it means, what to do              |

## License

MIT — see [LICENSE](LICENSE).
