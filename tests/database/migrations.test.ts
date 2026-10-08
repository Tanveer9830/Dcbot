import { afterAll, describe, expect, it } from 'vitest';
import { checksum, migrate, migrationStatus, readMigrations } from '@dcbot/database';
import { createTestDatabase, MIGRATIONS_DIR, type TestDatabase } from '../helpers/db.js';

const open: Array<() => Promise<void>> = [];

afterAll(async () => {
  await Promise.all(open.map((close) => close()));
});

async function freshDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase({ skipMigrations: true });
  open.push(() => db.close());
  return db;
}

describe('migrations', () => {
  it('are numbered, ordered and uniquely named on disk', async () => {
    const migrations = await readMigrations(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThanOrEqual(5);

    const names = migrations.map((migration) => migration.name);
    expect([...names].sort()).toEqual(names); // already sorted
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('apply in order and are recorded with a checksum', async () => {
    const db = await freshDatabase();
    const result = await migrate(db, MIGRATIONS_DIR);

    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);
    expect(result.checksumMismatch).toEqual([]);

    const status = await migrationStatus(db, MIGRATIONS_DIR);
    expect(status.every((row) => row.applied)).toBe(true);
    expect(status[0]?.checksum).toBe(checksum((await readMigrations(MIGRATIONS_DIR))[0]!.sql));
  });

  it('are idempotent: a second run applies nothing', async () => {
    const db = await freshDatabase();
    await migrate(db, MIGRATIONS_DIR);
    const second = await migrate(db, MIGRATIONS_DIR);

    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('detect a migration that was edited after it was applied', async () => {
    const db = await freshDatabase();
    await migrate(db, MIGRATIONS_DIR);
    const first = await readMigrations(MIGRATIONS_DIR);

    // Simulate someone editing an already-applied file instead of adding a new one.
    await db.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [
      'deadbeef',
      first[0]!.name,
    ]);

    const detected = await migrate(db, MIGRATIONS_DIR);
    expect(detected.checksumMismatch.map((row) => row.name)).toContain(first[0]!.name);
    expect(detected.applied).toEqual([]); // it must not re-run the migration

    await expect(migrate(db, MIGRATIONS_DIR, { strictChecksums: true })).rejects.toThrow(
      /modified on disk/,
    );
  });

  it('create the tables the repositories depend on', async () => {
    const db = await freshDatabase();
    await migrate(db, MIGRATIONS_DIR);

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((row) => row.table_name);
    for (const required of [
      'guilds',
      'guild_settings',
      'moderation_cases',
      'warnings',
      'economy_accounts',
      'economy_transactions',
      'xp_profiles',
      'security_events',
      'security_settings',
      'no_tag_protected',
      'no_tag_violations',
      'no_pin_events',
      'tickets',
      'custom_commands',
      'audit_logs',
      'scheduled_tasks',
      'dashboard_sessions',
    ]) {
      expect(names, `missing table ${required}`).toContain(required);
    }
  });

  it('keep balances non-negative at the schema level', async () => {
    const db = await freshDatabase();
    await migrate(db, MIGRATIONS_DIR);

    await expect(
      db.query('INSERT INTO economy_accounts (guild_id, user_id, wallet) VALUES ($1, $2, -1)', [
        '1',
        '1',
      ]),
    ).rejects.toThrow();
  });

  it('report status for a database that has never been migrated', async () => {
    const db = await freshDatabase();
    const status = await migrationStatus(db, MIGRATIONS_DIR);
    expect(status.length).toBeGreaterThan(0);
    expect(status.every((row) => !row.applied)).toBe(true);
  });
});
