import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Queryable } from './client.js';

export interface Migration {
  name: string;
  sql: string;
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
  appliedAt?: string | null;
  checksum?: string | null;
}

/**
 * SQL file migration runner.
 *
 * Migrations are plain .sql files applied in lexical filename order, each in
 * its own transaction, and recorded in `schema_migrations`. No ORM, no
 * code-generated DDL - the SQL in database/migrations is the source of truth.
 */
export async function readMigrations(dir: string): Promise<Migration[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    migrations.push({ name: file, sql });
  }
  return migrations;
}

export async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER
    );
  `);
}

/** FNV-1a 32-bit checksum, dependency free and stable across platforms. */
export function checksum(sql: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sql.length; i += 1) {
    hash ^= sql.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface MigrateOptions {
  /** Called for each migration as it is applied. */
  onApply?: (name: string) => void;
  /** Refuse to run when an already applied file changed on disk. */
  strictChecksums?: boolean;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  checksumMismatch: Array<{ name: string; expected: string; actual: string }>;
}

/** Applies pending migrations. Safe to run concurrently across processes. */
export async function migrate(
  db: Queryable,
  dir: string,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const migrations = await readMigrations(dir);
  await ensureMigrationsTable(db);

  const existing = await db.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name',
  );
  const appliedMap = new Map(existing.rows.map((row) => [row.name, row.checksum]));

  const result: MigrateResult = { applied: [], skipped: [], checksumMismatch: [] };

  for (const migration of migrations) {
    const sum = checksum(migration.sql);
    const previous = appliedMap.get(migration.name);
    if (previous !== undefined) {
      result.skipped.push(migration.name);
      if (previous !== sum) {
        result.checksumMismatch.push({ name: migration.name, expected: previous, actual: sum });
      }
      continue;
    }

    const started = Date.now();
    await db.query('BEGIN');
    try {
      await db.query(migration.sql);
      await db.query(
        'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
        [migration.name, sum, Date.now() - started],
      );
      await db.query('COMMIT');
      result.applied.push(migration.name);
      options.onApply?.(migration.name);
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.name} failed: ${message}`);
    }
  }

  if (options.strictChecksums && result.checksumMismatch.length > 0) {
    throw new Error(
      `Applied migrations were modified on disk: ${result.checksumMismatch.map((m) => m.name).join(', ')}. ` +
        'Never edit an applied migration - add a new one instead.',
    );
  }
  return result;
}

/** Reports which migrations are applied without changing anything. */
export async function migrationStatus(db: Queryable, dir: string): Promise<MigrationStatus[]> {
  const migrations = await readMigrations(dir);
  await ensureMigrationsTable(db);
  const existing = await db.query<{ name: string; checksum: string; applied_at: string }>(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  const applied = new Map(existing.rows.map((row) => [row.name, row]));
  return migrations.map((migration) => {
    const row = applied.get(migration.name);
    return {
      name: migration.name,
      applied: Boolean(row),
      appliedAt: row?.applied_at ?? null,
      checksum: row?.checksum ?? null,
    };
  });
}
