# Database

Dcbot uses **PostgreSQL only**. There is no MongoDB, Mongoose or any other
document store anywhere in this repository, and no abstraction layer that would
let one be dropped in: the repositories issue SQL through `pg`.

- Driver: [`pg`](https://node-postgres.com/) via `packages/database`
- Migrations: plain SQL files in `database/migrations`, applied in filename order
- No ORM. Every query is written out, which is what makes the invariants below
  readable and testable.

## Connection handling

`packages/database/src/client.ts` wraps a single `pg.Pool`:

| Setting                   | Value                                                 | Why                                            |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `max`                     | `DATABASE_POOL_MAX` (default 10)                      | One pool per process; shards share it          |
| `statement_timeout`       | 15s                                                   | A stuck query cannot wedge the gateway handler |
| `idleTimeoutMillis`       | 30s                                                   | Idle clients are recycled                      |
| `connectionTimeoutMillis` | 10s                                                   | Fails fast instead of queueing forever         |
| `ssl`                     | `DATABASE_SSL=true` → `{ rejectUnauthorized: false }` | Managed providers (Neon, Supabase, RDS)        |

Driver errors are re-wrapped so a connection string can never leak into a log
line or a Discord reply (`postgres://…` is replaced with `[redacted]`).

## Migrations

```bash
npm run migrate          # apply everything that has not been applied
npm run migrate:status   # show applied / pending without changing anything
```

Each migration:

1. is read from `database/migrations/*.sql` in filename order (`0001_core.sql` …
   `0005_dashboard.sql`),
2. runs inside its own transaction, so a failure leaves no half-applied state,
3. is recorded in `schema_migrations` with an FNV-1a checksum of its contents.

Editing an applied migration is detected: `migrate` reports a checksum mismatch,
and `migrate --strict` (used by the deployment checklist) fails. Add a new file
instead. Migration files must be valid plain SQL — no plpgsql, no extensions —
which is also what lets the test suite run them against an in-memory PostgreSQL.

### What each migration creates

| File                        | Tables                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_core.sql`             | `guilds`, `guild_settings`, `moderation_cases`, `warnings`, `audit_logs`, `custom_commands`, `scheduled_tasks`                                                                 |
| `0002_security.sql`         | `security_settings`, `security_trusted_users`, `security_trusted_roles`, `security_events`, `no_tag_protected`, `no_tag_violations`, `no_pin_events`                           |
| `0003_economy_leveling.sql` | `economy_accounts`, `economy_transactions`, `shop_items`, `inventory_items`, `quests`, `user_quests`, `achievements`, `user_achievements`, `xp_profiles`, `level_role_rewards` |
| `0004_community.sql`        | `tickets`, `ticket_messages`, `giveaways`, `giveaway_entries`, `suggestions`, `reaction_roles`, `starboard_entries`, `polls`, `poll_votes`, `birthdays`, `reminders`           |
| `0005_dashboard.sql`        | `dashboard_sessions`, plus the `guild_overview` read model                                                                                                                     |

## Invariants that matter

These are enforced in SQL, not in application code, so a bug in a command cannot
break them. Each one has a test in `tests/database/`.

**Economy**

- `CHECK (wallet >= 0)` and `CHECK (bank >= 0)` on `economy_accounts`.
- Every debit is a _guarded_ update: `… SET wallet = wallet - $3::bigint WHERE
wallet >= $3::bigint RETURNING *`. A row that cannot pay simply does not come
  back, and the operation fails without writing anything.
- Transfers lock both accounts `FOR UPDATE` in lexicographic `user_id` order, so
  A→B and B→A take locks in the same order and cannot deadlock.
- Every mutation appends to `economy_transactions`; balances are never edited
  without a ledger row.
- `idempotency_key` is unique and suffixed `:debit` / `:credit`, so a retried
  transfer is rejected as a duplicate instead of paying twice.
- Timed rewards (`daily`, `weekly`, `work`) re-check the cooldown inside the
  `UPDATE … WHERE` clause. Two simultaneous claims cannot both win.

**Leveling**

- XP is awarded only when `last_xp_at` is outside the cooldown window — again in
  the `UPDATE … WHERE`, not in a read-then-write.
- Level is derived from XP with `100 * N²` cumulative (`levelForXp` in
  `packages/shared`), so the bot and the dashboard can never disagree.

**Moderation**

- Case numbers are sequential per guild: `COALESCE(MAX(case_number), 0) + 1`
  inside the `INSERT`.
- `revokeCase` only affects rows that are not already revoked, so a second
  revoke reports failure instead of claiming success.

**Settings**

- Guild settings live in JSONB columns on `guild_settings`, one column per
  group. `updateSettingsGroup` validates the group name against the
  `SETTINGS_GROUPS` allowlist before it is interpolated into SQL, so the column
  name can never come from user input.

**Scheduling**

- The scheduler claims due tasks with `FOR UPDATE SKIP LOCKED`, so two bot
  processes never run the same reminder or giveaway twice.

## Retention

Housekeeping runs every six hours (`apps/bot/src/automation/scheduler.ts`):

| Data                                              | Kept for            |
| ------------------------------------------------- | ------------------- |
| Expired dashboard sessions                        | purged on every run |
| Completed scheduled tasks                         | 7 days              |
| Audit log rows                                    | 90 days             |
| Security events, no-tag violations, no-pin events | 90 days             |

Retention is implemented in TypeScript (`AuditRepository.prune`,
`SecurityRepository.pruneOldRows`) rather than in a stored procedure, so it is
covered by the test suite.

## Testing

`tests/helpers/db.ts` gives every test a database with all migrations applied:

- With `TEST_DATABASE_URL` set (CI), it is a real PostgreSQL service, so
  transactions, JSONB concatenation and every other server behaviour is genuine.
- Without it, the suite runs on [`pg-mem`](https://github.com/oguimbal/pg-mem),
  an in-memory PostgreSQL emulator, so `npm test` works on a laptop with no
  database installed.

pg-mem does not implement everything, and the harness says so rather than
pretending: `BEGIN`/`ROLLBACK` do not undo writes, JSONB `||` is missing, and
`CREATE TABLE IF NOT EXISTS` cannot run twice. The two tests that need JSONB
concatenation are gated on `USES_REAL_POSTGRES` and therefore **run in CI and are
skipped locally** — `npm test` reports them as skipped, never as passing.
