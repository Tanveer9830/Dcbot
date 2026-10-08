# Security model

This document describes how Dcbot decides who may do what, what it protects, and
— equally important — what it **cannot** protect because Discord does not expose
the necessary hooks.

## 1. Authorization

### Bot owner

`OwnerPolicy` (`packages/shared/src/authorization.ts`) is the single source of
truth for bot ownership. Nothing else in the codebase makes that decision.

- Owners come **only** from `BOT_OWNER_IDS` (comma separated snowflakes). The
  project ships with `1131248987173814336,1473315482554732786`; both IDs have
  identical privileges, and adding or removing one is a configuration change, not
  a code change.
- **A guild Administrator is never a bot owner.** That rule is asserted in
  `tests/shared/authorization.test.ts`.
- An empty owner list fails at boot in strict mode, so a misconfigured
  deployment cannot silently become ownerless (or worse, owner-everyone).
- An invalid entry throws with the offending value **masked** (`11312…4336`) so a
  typo cannot be pasted into a public log.
- There are no hidden admin accounts, no backdoor IDs and no secret commands.
  `docs/COMMANDS.md` is generated from the live registry, so the owner-only list
  you read there is the list the bot enforces.

Owner-only commands: `/globalcommand`, `/branding`, `/guilds`, `/health`.

### Server staff

`isGuildStaff` allows: Manage Server **or** Ban Members **or** a configured staff
role **or** an explicitly trusted user (`/security trust`). The same helper is
used by the command registry and by the security repositories, so there is one
definition of "staff".

### Command gate

`CommandRegistry.authorize()` is the only place a command's access is decided:

1. `ownerOnly` → owner check, and nothing else can satisfy it;
2. bot permissions (fails with "the bot is missing …" before blaming the user);
3. member permissions;
4. `staffOnly` → `isGuildStaff`.

Cooldowns are applied **after** authorization, so an unauthorized caller cannot
consume a legitimate user's cooldown.

### What is deliberately absent

- **No `eval`, no `Function`, no `vm`** anywhere in the repository. The
  calculator is a hand-written recursive-descent parser
  (`safeEvaluate`); templates are a single-pass `{{variable}}` substitution over
  a fixed allowlist (`renderTemplate`). Both are covered by tests that feed them
  `process.exit(1)`, `require("fs")` and similar payloads.
- No guild-level "run this code" command. Custom commands are static text with
  template variables.

## 2. Protection systems

All thresholds live in `apps/bot/src/security/thresholds.ts` as pure functions —
plain data in, decision out — so the exact trigger conditions are unit tested
(`tests/bot/thresholds.test.ts`) rather than inferred from Discord behaviour.

| System                      | Trigger                                                                           | Default       | Action                                |
| --------------------------- | --------------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| Anti-raid                   | joins inside a window                                                             | 5 joins / 10s | alert, optional lockdown              |
| Anti-spam / flood           | messages per user inside a window                                                 | 5 / 5s        | delete, timeout                       |
| Anti-mention                | mentions in one message                                                           | 10            | delete                                |
| Caps                        | uppercase letter ratio                                                            | configurable  | delete / warn                         |
| Repeat                      | identical message N times                                                         | 3             | delete                                |
| Suspicious account          | account younger than N days                                                       | off (0)       | alert / kick                          |
| Mass ban / kick             | actions inside a window                                                           | configurable  | alert + critical event                |
| Dangerous permission change | Administrator, Manage Server/Roles/Webhooks/Channels, Ban, Kick, Moderate granted | always on     | alert + critical event                |
| Anti-nuke                   | channel/role/webhook destruction rate, mass moderation                            | configurable  | strip roles, alert, optional lockdown |

Severity escalates with the overshoot (medium → high → critical), and recent
history is escalated by `escalate()`.

**Trusted users and roles bypass detection.** They are recorded in
`security_trusted_users` / `security_trusted_roles` with who granted them and why.

**Lockdown** (`security/lockdown.ts`) denies `SendMessages` for `@everyone` on
the channels it locks and restores the previous overwrites on unlock. It only
touches channels the bot can actually edit, and reports how many it locked
instead of claiming the whole server.

## 3. `/no-tag` and `/no-pin`: what Discord actually allows

These two systems are documented with their limits because the alternative —
claiming to "block" something — would be false.

### `/no-tag` (mention protection)

- Discord provides **no pre-send hook for mentions**. The bot cannot prevent a
  mention from being delivered to the protected user's client. It reacts after
  the fact: log, delete the message, warn, or time out the author.
- Deleting requires **Manage Messages** in that channel.
- Mentions in DMs, in other servers, or in messages the bot never received are
  out of reach.
- A user mentioning themselves is never a violation; bots and server staff are
  exempt by default, and per-user / per-role exemptions are configurable.
- Every violation is stored with the offender, the protected user and the action
  taken (`no_tag_violations`), which is what `/notag violations` reads.

### `/no-pin` (pin monitoring)

- There is **no gateway event before a pin happens**, and no permission that
  blocks pinning without also blocking all of Manage Messages.
- The bot observes `channelPinsUpdate`, records the event, attributes the actor
  **via the audit log when it can**, and can optionally unpin.
- When attribution is not possible, the record says `actor_source = 'unknown'`.
  It never guesses who pinned something.
- Unpinning is best-effort and requires Manage Messages.

## 4. Secrets and personal data

- `.env` is git-ignored; `.env.example` contains placeholders only.
- One token variable name: `DISCORD_TOKEN`.
- The logger redacts values whose key looks like a credential
  (`token`, `secret`, `password`, `authorization`, `cookie`, `api_key`,
  `private`) before anything is written.
- Database errors are re-wrapped so a connection string cannot leak.
- Audit rows pass through `sanitize()`; client IPs are stored as SHA-256 hashes.
- Dashboard access tokens are stored **hashed** in `dashboard_sessions`; the
  plaintext token only exists inside the encrypted session cookie.
- Owner IDs are masked in logs and in the dashboard owner panel.

## 5. Dashboard authentication

See `docs/DASHBOARD.md` for the full flow. In short:

- OAuth2 authorization-code flow with a random `state` value stored in a
  short-lived cookie and compared on callback (CSRF protection).
- Session cookies are **encrypted** (JWE, `dir` + `A256GCM`, key = SHA-256 of
  `SESSION_SECRET`), `httpOnly`, `sameSite=lax`, `secure` in production, 12h
  lifetime.
- Authorization is re-checked **server-side on every mutating request** against
  the user's guild list from Discord's API (`assertGuildManager`), never against
  a client-supplied permission value.
- Settings writes are limited to an allowlist of groups
  (`apps/dashboard/lib/settingsPolicy.ts`), capped at 16 KB, and audited.
- `SESSION_SECRET` shorter than 32 characters is reported as a configuration
  error on the dashboard home page.

## 6. Bot metrics API

`BOT_API_ENABLED=true` exposes uptime, gateway latency, memory, service health
and log counters to the dashboard. It:

- refuses to start without `BOT_API_TOKEN`,
- requires `Authorization: Bearer <token>` on every endpoint except `/healthz`,
  compared with `timingSafeEqual`,
- binds to `127.0.0.1` by default (`BOT_API_HOST`),
- only reports measurements taken in the running process.

## 7. Dependencies

`scripts/audit.mjs` is the audit gate in CI. Any high/critical advisory fails the
build unless the package is on the allowlist **with a written reason**.

Currently accepted:

| Package   | Severity | Why accepted                                                                                                                                                                                                                                                                                              | Remediation                                                     |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `next`    | critical | The published advisories span 9.3.4-canary.0 → 16.3.0-preview.10, so no Next 14 release is clean. This dashboard uses none of the affected surfaces: no `next/image` remote patterns, no rewrites/redirects, no middleware, no custom server, no i18n, no Server Actions, no `beforeInteractive` scripts. | Upgrade to Next 16 (breaking) and re-run the build + test suite |
| `postcss` | high     | Transitive dependency of `next` 14; not used to process untrusted CSS at runtime.                                                                                                                                                                                                                         | Resolved by the Next upgrade                                    |

Review this table when bumping `next`, and remove entries as soon as they are
fixed.

## 8. Reporting a vulnerability

Open a private security advisory on the repository, or contact the owner IDs
listed in `BOT_OWNER_IDS` through Discord. Please include a reproduction and the
affected version; do not open a public issue for an exploitable problem.
