import type { Queryable } from '../client.js';
import type { Transactional } from '../transaction.js';
import { levelForXp, type XpProfile } from '@dcbot/shared';

export interface AwardResult {
  profile: XpProfile;
  awarded: number;
  leveledUp: boolean;
  previousLevel: number;
  newRoles: string[];
}

/**
 * XP repository.
 *
 * The cooldown check lives inside the UPDATE's WHERE clause, so two messages
 * arriving in the same tick cannot both award XP (anti-farming).
 */
export class LevelingRepository {
  constructor(
    private readonly db: Queryable & Transactional,
    private readonly cooldownMs = 60_000,
  ) {}

  async getProfile(guildId: string, userId: string): Promise<XpProfile> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM xp_profiles WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    const row = result.rows[0];
    if (row) return mapProfile(row);
    return {
      guildId,
      userId,
      xp: 0,
      level: 0,
      messages: 0,
      lastXpAt: null,
    };
  }

  async leaderboard(guildId: string, limit = 10): Promise<Array<XpProfile & { rank: number }>> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM xp_profiles WHERE guild_id = $1 ORDER BY xp DESC, user_id LIMIT $2`,
      [guildId, limit],
    );
    // Total ordering means the row position is the rank, same as ROW_NUMBER().
    return result.rows.map((row, index) => ({ ...mapProfile(row), rank: index + 1 }));
  }

  async rankOf(guildId: string, userId: string): Promise<number | null> {
    const result = await this.db.query<{ rank: string }>(
      `SELECT COUNT(*)::text AS rank FROM xp_profiles
        WHERE guild_id = $1 AND xp > (SELECT COALESCE(xp, 0) FROM xp_profiles WHERE guild_id = $1 AND user_id = $2)`,
      [guildId, userId],
    );
    const count = Number(result.rows[0]?.rank ?? '0');
    const exists = await this.db.query<{ one: number }>(
      'SELECT 1 AS one FROM xp_profiles WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return exists.rows[0] ? count + 1 : null;
  }

  /**
   * Awards XP if the per-user cooldown has elapsed. Returns awarded = 0 when
   * the cooldown blocked the grant.
   */
  async awardXp(params: {
    guildId: string;
    userId: string;
    amount: number;
    multiplier?: number;
  }): Promise<AwardResult> {
    const multiplier = params.multiplier ?? 1;
    const amount = Math.max(0, Math.floor(params.amount * multiplier));

    return this.db.transaction(async (tx) => {
      const before = await tx.query<Record<string, unknown>>(
        `INSERT INTO xp_profiles (guild_id, user_id, xp, level, messages)
         VALUES ($1, $2, 0, 0, 0)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING *`,
        [params.guildId, params.userId],
      );
      const previous = mapProfile(before.rows[0]!);

      const updated = await tx.query<Record<string, unknown>>(
        `UPDATE xp_profiles
            SET xp = xp + $3::bigint,
                messages = messages + 1,
                last_xp_at = now(),
                updated_at = now()
          WHERE guild_id = $1 AND user_id = $2
            AND (last_xp_at IS NULL OR last_xp_at < now() - ($4 || ' milliseconds')::interval)
          RETURNING *`,
        [params.guildId, params.userId, amount, String(this.cooldownMs)],
      );

      const row = updated.rows[0];
      if (!row) {
        return {
          profile: previous,
          awarded: 0,
          leveledUp: false,
          previousLevel: previous.level,
          newRoles: [],
        };
      }

      const after = mapProfile(row);
      const newLevel = levelForXp(after.xp);
      let leveledUp = false;
      let finalProfile = after;
      if (newLevel !== after.level) {
        const leveled = await tx.query<Record<string, unknown>>(
          'UPDATE xp_profiles SET level = $3::int, updated_at = now() WHERE guild_id = $1 AND user_id = $2 RETURNING *',
          [params.guildId, params.userId, newLevel],
        );
        finalProfile = mapProfile(leveled.rows[0]!);
        leveledUp = newLevel > previous.level;
      }

      let newRoles: string[] = [];
      if (leveledUp) {
        const roles = await tx.query<{ role_id: string }>(
          `SELECT role_id FROM level_role_rewards
            WHERE guild_id = $1 AND level > $2 AND level <= $3
            ORDER BY level`,
          [params.guildId, previous.level, finalProfile.level],
        );
        newRoles = roles.rows.map((row) => row.role_id);
      }

      return {
        profile: finalProfile,
        awarded: amount,
        leveledUp,
        previousLevel: previous.level,
        newRoles,
      };
    });
  }

  /** Admin adjustment; logged by the caller through the audit repository. */
  async setXp(guildId: string, userId: string, xp: number): Promise<XpProfile> {
    const safe = Math.max(0, Math.floor(xp));
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO xp_profiles (guild_id, user_id, xp, level)
       VALUES ($1, $2, $3::bigint, $4::int)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, updated_at = now()
       RETURNING *`,
      [guildId, userId, safe, levelForXp(safe)],
    );
    return mapProfile(result.rows[0]!);
  }

  async setRoleReward(guildId: string, level: number, roleId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO level_role_rewards (guild_id, level, role_id) VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, level) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [guildId, level, roleId],
    );
  }

  async roleRewards(guildId: string): Promise<Array<{ level: number; roleId: string }>> {
    const result = await this.db.query<{ level: number; role_id: string }>(
      'SELECT level, role_id FROM level_role_rewards WHERE guild_id = $1 ORDER BY level',
      [guildId],
    );
    return result.rows.map((row) => ({ level: Number(row.level), roleId: row.role_id }));
  }
}

function mapProfile(row: Record<string, unknown>): XpProfile {
  return {
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    xp: Number(row.xp),
    level: Number(row.level),
    messages: Number(row.messages),
    lastXpAt: row.last_xp_at ? new Date(String(row.last_xp_at)) : null,
  };
}
