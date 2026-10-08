import type { Queryable } from '../client.js';
import type { ModerationActionType, ModerationCase, Warning } from '@dcbot/shared';

export class ModerationRepository {
  constructor(private readonly db: Queryable) {}

  /** Creates a case with a per-guild sequential number. */
  async createCase(
    params: {
      guildId: string;
      type: ModerationActionType;
      targetId: string;
      actorId: string;
      reason: string;
      evidenceUrl?: string | null;
      expiresAt?: Date | null;
    },
  ): Promise<ModerationCase> {
    const row = await this.db.query<{ case_number: number }>(
      `INSERT INTO moderation_cases (guild_id, case_number, type, target_id, actor_id, reason, evidence_url, expires_at)
       VALUES ($1, (SELECT COALESCE(MAX(case_number), 0) + 1 FROM moderation_cases WHERE guild_id = $1),
               $2, $3, $4, $5, $6, $7)
       RETURNING case_number`,
      [
        params.guildId,
        params.type,
        params.targetId,
        params.actorId,
        params.reason,
        params.evidenceUrl ?? null,
        params.expiresAt ?? null,
      ],
    );
    const caseNumber = row.rows[0]?.case_number ?? 1;
    const created = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM moderation_cases WHERE guild_id = $1 AND case_number = $2',
      [params.guildId, caseNumber],
    );
    return mapCase(created.rows[0]!);
  }

  /**
   * Creates several cases atomically. Used for bulk moderation so the case
   * numbers stay contiguous and either all rows land or none do.
   */
  async createCases(
    tx: Queryable,
    items: Array<{
      guildId: string;
      type: ModerationActionType;
      targetId: string;
      actorId: string;
      reason: string;
    }>,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (const item of items) {
      const row = await tx.query<{ case_number: number }>(
        `INSERT INTO moderation_cases (guild_id, case_number, type, target_id, actor_id, reason)
         VALUES ($1, (SELECT COALESCE(MAX(case_number), 0) + 1 FROM moderation_cases WHERE guild_id = $1),
                 $2, $3, $4, $5)
         RETURNING case_number`,
        [item.guildId, item.type, item.targetId, item.actorId, item.reason],
      );
      ids.push(Number(row.rows[0]?.case_number ?? 0));
    }
    return ids;
  }

  async listCasesForUser(
    guildId: string,
    userId: string,
    limit = 25,
  ): Promise<ModerationCase[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM moderation_cases
        WHERE guild_id = $1 AND target_id = $2
        ORDER BY case_number DESC LIMIT $3`,
      [guildId, userId, limit],
    );
    return result.rows.map(mapCase);
  }

  async listCasesByActor(guildId: string, actorId: string, limit = 25): Promise<ModerationCase[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM moderation_cases
        WHERE guild_id = $1 AND actor_id = $2
        ORDER BY case_number DESC LIMIT $3`,
      [guildId, actorId, limit],
    );
    return result.rows.map(mapCase);
  }

  async countCasesSince(guildId: string, actorId: string, since: Date): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM moderation_cases
        WHERE guild_id = $1 AND actor_id = $2 AND created_at >= $3`,
      [guildId, actorId, since],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async revokeCase(guildId: string, caseNumber: number): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE moderation_cases SET revoked = TRUE WHERE guild_id = $1 AND case_number = $2 AND revoked = FALSE',
      [guildId, caseNumber],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async activeTimeouts(guildId: string): Promise<ModerationCase[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM moderation_cases
        WHERE guild_id = $1 AND type = 'timeout' AND revoked = FALSE
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY expires_at ASC NULLS LAST`,
      [guildId],
    );
    return result.rows.map(mapCase);
  }

  async addWarning(params: {
    guildId: string;
    userId: string;
    moderatorId: string;
    reason: string;
  }): Promise<Warning> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.guildId, params.userId, params.moderatorId, params.reason],
    );
    return mapWarning(result.rows[0]!);
  }

  async warningsFor(guildId: string, userId: string): Promise<Warning[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [guildId, userId],
    );
    return result.rows.map(mapWarning);
  }

  async acknowledgeWarning(guildId: string, warningId: number): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE warnings SET acknowledged = TRUE WHERE guild_id = $1 AND id = $2',
      [guildId, warningId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function mapCase(row: Record<string, unknown>): ModerationCase {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    caseNumber: Number(row.case_number),
    type: row.type as ModerationActionType,
    targetId: String(row.target_id),
    actorId: String(row.actor_id),
    reason: String(row.reason),
    evidenceUrl: (row.evidence_url as string | null) ?? null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    revoked: Boolean(row.revoked),
    createdAt: new Date(String(row.created_at)),
  };
}

function mapWarning(row: Record<string, unknown>): Warning {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    moderatorId: String(row.moderator_id),
    reason: String(row.reason),
    acknowledged: Boolean(row.acknowledged),
    createdAt: new Date(String(row.created_at)),
  };
}
