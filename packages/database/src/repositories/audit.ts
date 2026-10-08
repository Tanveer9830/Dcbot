import type { Queryable } from '../client.js';
import { createHash } from 'node:crypto';
import type { AuditEntry } from '@dcbot/shared';

export class AuditRepository {
  constructor(private readonly db: Queryable) {}

  async record(params: {
    guildId?: string | null;
    actorId: string;
    actorKind?: 'discord_user' | 'dashboard_user' | 'bot_owner' | 'system';
    action: string;
    targetType: string;
    targetId?: string;
    detail?: Record<string, unknown>;
    /** Optional client IP; stored only as a SHA-256 hash. */
    ip?: string | null;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO audit_logs (guild_id, actor_id, actor_kind, action, target_type, target_id, detail, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        params.guildId ?? null,
        params.actorId,
        params.actorKind ?? 'discord_user',
        params.action,
        params.targetType,
        params.targetId ?? '',
        JSON.stringify(sanitize(params.detail ?? {})),
        params.ip ? createHash('sha256').update(params.ip).digest('hex') : null,
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async list(params: {
    guildId?: string | null;
    actorId?: string;
    action?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.guildId) {
      values.push(params.guildId);
      conditions.push(`guild_id = $${values.length}`);
    }
    if (params.actorId) {
      values.push(params.actorId);
      conditions.push(`actor_id = $${values.length}`);
    }
    if (params.action) {
      values.push(params.action);
      conditions.push(`action = $${values.length}`);
    }
    values.push(params.limit ?? 50);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: (row.guild_id as string | null) ?? null,
      actorId: String(row.actor_id),
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      detail: (row.detail as Record<string, unknown>) ?? {},
      createdAt: new Date(String(row.created_at)),
    }));
  }

  /** Deletes audit rows older than the retention window. */
  async prune(retentionDays = 90): Promise<number> {
    const result = await this.db.query(
      "DELETE FROM audit_logs WHERE created_at < now() - ($1 || ' days')::interval",
      [String(retentionDays)],
    );
    return result.rowCount ?? 0;
  }
}

const SECRET_KEY_HINTS = [
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'private',
];

/** Strips values whose key looks like a credential before they hit the DB. */
export function sanitize(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const lower = key.toLowerCase();
    if (SECRET_KEY_HINTS.some((hint) => lower.includes(hint))) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string' && /(?:token|secret|password)\s*[:=]/i.test(value)) {
      out[key] = '[redacted]';
    } else {
      out[key] = value;
    }
  }
  return out;
}
