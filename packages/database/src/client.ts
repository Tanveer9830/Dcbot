import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { ConfigurationError, ServiceUnavailableError } from '@dcbot/shared';
import { redactConnectionString } from '@dcbot/config';

/**
 * Minimal query surface used by every repository.
 *
 * Keeping the repositories on this interface (instead of importing pg directly)
 * is what lets the test suite drive them with an in-memory fake and lets the
 * same code run inside a transaction client.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | null>;
}

export interface DatabaseOptions {
  connectionString: string;
  ssl?: boolean;
  max?: number;
  /** ms before a query is considered failed. */
  statementTimeoutMs?: number;
  applicationName?: string;
}

export class Database implements Queryable {
  private readonly pool: Pool;
  private readonly connectionString: string;
  private closed = false;

  constructor(options: DatabaseOptions) {
    if (!options.connectionString) {
      throw new ConfigurationError('DATABASE_URL is required to construct a Database.');
    }
    this.connectionString = options.connectionString;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
      max: options.max ?? 10,
      application_name: options.applicationName ?? 'dcbot',
      statement_timeout: options.statementTimeoutMs ?? 15_000,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (error) => {
      // Swallow idle-client errors: logging them is enough, crashing is not.
      console.error('[db] idle client error:', error.message);
    });
  }

  /** Redacted connection string, safe for logs and the dashboard. */
  get description(): string {
    return redactConnectionString(this.connectionString);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    if (this.closed) throw new ServiceUnavailableError('Database', 'Connection pool is closed.');
    try {
      return await this.pool.query<T>(text, params as unknown[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Never leak connection details that may appear in driver errors.
      throw new Error(`Database query failed: ${message.replace(/postgres:\/\/\S+/g, '[redacted]')}`);
    }
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  /**
   * Runs `work` inside a single transaction. Nested calls reuse the outer
   * transaction via a savepoint so repositories can compose safely.
   */
  async transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new TransactionClient(client, 0);
    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is already broken; the pool will discard it.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Cheap readiness probe used by health checks. */
  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

/** Transaction handle. Supports savepoints for nested composition. */
export class TransactionClient implements Queryable {
  constructor(
    private readonly client: PoolClient,
    private readonly depth: number,
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.client.query<T>(text, params as unknown[]);
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  /** Nested transaction using a savepoint. */
  async nested<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const name = `sp_${this.depth + 1}`;
    await this.client.query(`SAVEPOINT ${name}`);
    const tx = new TransactionClient(this.client, this.depth + 1);
    try {
      const result = await work(tx);
      await this.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    }
  }
}

let singleton: Database | null = null;

/** Process-wide database singleton. Pass `create: true` once at startup. */
export function getDatabase(connectionString: string, options?: Omit<DatabaseOptions, 'connectionString'>): Database {
  if (!singleton) singleton = new Database({ connectionString, ...options });
  return singleton;
}

export function hasDatabase(): boolean {
  return singleton !== null;
}

export async function closeDatabase(): Promise<void> {
  if (singleton) {
    await singleton.close();
    singleton = null;
  }
}
