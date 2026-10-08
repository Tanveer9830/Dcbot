import type { Queryable } from '../client.js';
import { createHash } from 'node:crypto';

export interface DashboardSession {
  id: string;
  userId: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
}

/**
 * Dashboard sessions.
 *
 * OAuth tokens are stored ONLY as SHA-256 hashes. A database leak therefore
 * cannot be replayed against Discord's API.
 */
export class SessionRepository {
  constructor(private readonly db: Queryable) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(params: {
    id: string;
    userId: string;
    username?: string | null;
    globalName?: string | null;
    avatar?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO dashboard_sessions
         (id, user_id, username, global_name, avatar, access_token_hash, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.id,
        params.userId,
        params.username ?? null,
        params.globalName ?? null,
        params.avatar ?? null,
        SessionRepository.hashToken(params.accessToken),
        params.refreshToken ? SessionRepository.hashToken(params.refreshToken) : null,
        params.expiresAt,
      ],
    );
  }

  async get(id: string): Promise<DashboardSession | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM dashboard_sessions WHERE id = $1',
      [id],
    );
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      username: (row.username as string | null) ?? null,
      globalName: (row.global_name as string | null) ?? null,
      avatar: (row.avatar as string | null) ?? null,
      expiresAt: new Date(String(row.expires_at)),
      createdAt: new Date(String(row.created_at)),
      lastSeenAt: new Date(String(row.last_seen_at)),
    };
  }

  async touch(id: string): Promise<void> {
    await this.db.query('UPDATE dashboard_sessions SET last_seen_at = now() WHERE id = $1', [id]);
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.db.query('DELETE FROM dashboard_sessions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.db.query('DELETE FROM dashboard_sessions WHERE user_id = $1', [userId]);
    return result.rowCount ?? 0;
  }

  async purgeExpired(): Promise<number> {
    const result = await this.db.query('DELETE FROM dashboard_sessions WHERE expires_at < now()');
    return result.rowCount ?? 0;
  }
}
