import type { Queryable } from '../client.js';
import type { ScheduledTask } from '@dcbot/shared';

/**
 * Durable task queue backed by PostgreSQL.
 *
 * Claims are atomic (`FOR UPDATE SKIP LOCKED`), so multiple bot shards can run
 * the same worker without double-executing a task.
 */
export class SchedulerRepository {
  constructor(private readonly db: Queryable) {}

  async schedule(params: {
    guildId?: string | null;
    kind: string;
    payload?: Record<string, unknown>;
    runAt: Date;
    maxAttempts?: number;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO scheduled_tasks (guild_id, kind, payload, run_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        params.guildId ?? null,
        params.kind,
        JSON.stringify(params.payload ?? {}),
        params.runAt,
        params.maxAttempts ?? 3,
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  /** Atomically claims up to `limit` due tasks. */
  async claim(limit = 10): Promise<ScheduledTask[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE scheduled_tasks
          SET attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM scheduled_tasks
           WHERE completed_at IS NULL AND run_at <= now() AND attempts < max_attempts
           ORDER BY run_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [limit],
    );
    return result.rows.map(mapTask);
  }

  async complete(id: number): Promise<void> {
    await this.db.query('UPDATE scheduled_tasks SET completed_at = now() WHERE id = $1', [id]);
  }

  async fail(id: number, error: string): Promise<void> {
    await this.db.query('UPDATE scheduled_tasks SET last_error = $2 WHERE id = $1', [
      id,
      error.slice(0, 500),
    ]);
  }

  async pending(limit = 50): Promise<ScheduledTask[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM scheduled_tasks
        WHERE completed_at IS NULL AND attempts < max_attempts
        ORDER BY run_at LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapTask);
  }

  async pruneCompleted(olderThanDays = 7): Promise<number> {
    const result = await this.db.query(
      "DELETE FROM scheduled_tasks WHERE completed_at IS NOT NULL AND completed_at < now() - ($1 || ' days')::interval",
      [String(olderThanDays)],
    );
    return result.rowCount ?? 0;
  }
}

function mapTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: Number(row.id),
    guildId: (row.guild_id as string | null) ?? null,
    kind: String(row.kind),
    payload: (row.payload as Record<string, unknown>) ?? {},
    runAt: new Date(String(row.run_at)),
    lastError: (row.last_error as string | null) ?? null,
    attempts: Number(row.attempts),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
    createdAt: new Date(String(row.created_at)),
  };
}
