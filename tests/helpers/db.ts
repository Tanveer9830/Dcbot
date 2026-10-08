/**
 * Test database harness.
 *
 * Two backends, chosen by the environment:
 *
 *   1. Real PostgreSQL when `TEST_DATABASE_URL` is set (this is what CI uses via a
 *      service container). Full semantics: transactions really roll back, JSONB
 *      concatenation, triggers, advisory locks.
 *   2. `pg-mem` (an in-memory PostgreSQL emulator) otherwise, so the suite also runs
 *      on a machine with no database installed.
 *
 * pg-mem is *not* a complete PostgreSQL. Differences that were measured before this
 * harness was written, and that the suite works around instead of papering over:
 *   - `BEGIN`/`ROLLBACK` parse but do not undo writes, so every assertion that
 *     depends on rollback is gated on `isRealPostgres`.
 *   - Numeric bind parameters need an explicit cast (`$1::bigint`) for arithmetic to
 *     evaluate. The repositories carry those casts, which is also valid (and
 *     stricter) PostgreSQL.
 *   - There is no plpgsql, so nothing in the schema may rely on stored procedures.
 *
 * Tests must only assert behaviour that the active backend genuinely implements.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import type { QueryResult, QueryResultRow } from 'pg';
import { Database, migrate, type Queryable, type Transactional } from '@dcbot/database';

export interface TestDatabase extends Queryable, Transactional {
  /** True when backed by real PostgreSQL (false when backed by pg-mem). */
  isRealPostgres: boolean;
  /** Human readable backend name, shown in test output. */
  label: string;
  close(): Promise<void>;
}

/**
 * True when the suite is running against real PostgreSQL. Used with `it.runIf`
 * for the handful of behaviours pg-mem does not implement (see header comment).
 */
export const USES_REAL_POSTGRES = Boolean(process.env.TEST_DATABASE_URL);

export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'database',
  'migrations',
);

/** Migration SQL in application order, read straight from disk. */
export async function migrationFiles(): Promise<Array<{ name: string; sql: string }>> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(join(MIGRATIONS_DIR, name), 'utf8') })),
  );
}

export interface TestDatabaseOptions {
  /** Skip applying migrations (for tests that run the migrator themselves). */
  skipMigrations?: boolean;
}

/**
 * Creates an isolated database with every migration applied.
 *
 * `TEST_DATABASE_URL` is read here rather than through `@dcbot/config` so the suite
 * runs without the bot's full environment being present.
 */
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? createPostgresTestDatabase(url) : createMemoryTestDatabase();
  if (!options.skipMigrations) {
    const result = await migrate(db, MIGRATIONS_DIR);
    if (result.checksumMismatch.length > 0) {
      throw new Error(`Migration checksum mismatch: ${JSON.stringify(result.checksumMismatch)}`);
    }
  }
  return db;
}

function createPostgresTestDatabase(url: string): TestDatabase {
  const real = new Database({ connectionString: url, applicationName: 'dcbot-test' });
  return {
    isRealPostgres: true,
    label: 'postgresql',
    query: (text, params) => real.query(text, params as unknown[]),
    queryOne: (text, params) => real.queryOne(text, params as unknown[]),
    transaction: (work) => real.transaction(work),
    close: () => real.close(),
  };
}

function createMemoryTestDatabase(): TestDatabase {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();

  // pg-mem cannot execute `CREATE TABLE IF NOT EXISTS` a second time once the table
  // exists (it raises "parts of the AST have not been read"). The migrator runs that
  // statement on every migrate()/migrationStatus() call, so the second and later
  // no-op runs are short-circuited here. Nothing else is intercepted.
  let migrationsTableCreated = false;
  const isEnsureMigrationsTable = (text: string): boolean =>
    /^\s*CREATE TABLE IF NOT EXISTS schema_migrations\b/i.test(text);

  const query = <T extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> => {
    if (isEnsureMigrationsTable(text)) {
      if (migrationsTableCreated) {
        return Promise.resolve({
          rows: [],
          rowCount: 0,
          command: 'CREATE',
          oid: 0,
          fields: [],
        } as unknown as QueryResult<T>);
      }
      migrationsTableCreated = true;
    }
    return pool.query(text, (params ?? []) as unknown[]) as Promise<QueryResult<T>>;
  };

  const queryOne = <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | null> => query<T>(text, params).then((result) => result.rows[0] ?? null);

  const queryable: Queryable = { query, queryOne };

  return {
    isRealPostgres: false,
    label: 'pg-mem',
    query,
    queryOne,
    // pg-mem accepts BEGIN/COMMIT but does not implement rollback. Tests that need
    // real rollback semantics gate on isRealPostgres rather than trusting this.
    transaction: async (work) => {
      await pool.query('BEGIN');
      try {
        const result = await work(queryable);
        await pool.query('COMMIT');
        return result;
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    },
    close: async () => {
      await pool.end?.();
    },
  };
}
