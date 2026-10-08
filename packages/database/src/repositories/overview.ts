import type { Queryable } from '../client.js';

export interface GuildOverview {
  guildId: string;
  name: string | null;
  memberCount: number | null;
  botJoinedAt: Date;
  moderationCases: number;
  warnings: number;
  securityEvents: number;
  openTickets: number;
  activeGiveaways: number;
  guildCommands: number;
  rankedMembers: number;
}

/** Read model used by the dashboard. Every number is a real COUNT(*). */
export class OverviewRepository {
  constructor(private readonly db: Queryable) {}

  async forGuild(guildId: string): Promise<GuildOverview | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM guild_overview WHERE guild_id = $1',
      [guildId],
    );
    if (!row) return null;
    return {
      guildId: String(row.guild_id),
      name: (row.name as string | null) ?? null,
      memberCount: row.member_count === null ? null : Number(row.member_count),
      botJoinedAt: new Date(String(row.bot_joined_at)),
      moderationCases: Number(row.moderation_cases),
      warnings: Number(row.warnings),
      securityEvents: Number(row.security_events),
      openTickets: Number(row.open_tickets),
      activeGiveaways: Number(row.active_giveaways),
      guildCommands: Number(row.guild_commands),
      rankedMembers: Number(row.ranked_members),
    };
  }

  /** Per-day security event counts for the dashboard chart (real data only). */
  async securityEventSeries(
    guildId: string,
    days = 14,
  ): Promise<Array<{ day: string; count: number }>> {
    const result = await this.db.query<{ day: string; count: string }>(
      `SELECT date_trunc('day', created_at)::date::text AS day, COUNT(*)::text AS count
         FROM security_events
        WHERE guild_id = $1 AND created_at >= now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      [guildId, String(days)],
    );
    return result.rows.map((row) => ({ day: row.day, count: Number(row.count) }));
  }

  async topLevels(guildId: string, limit = 5): Promise<Array<{ userId: string; xp: number; level: number }>> {
    const result = await this.db.query<{ user_id: string; xp: string; level: number }>(
      'SELECT user_id, xp::text AS xp, level FROM xp_profiles WHERE guild_id = $1 ORDER BY xp DESC LIMIT $2',
      [guildId, limit],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      xp: Number(row.xp),
      level: Number(row.level),
    }));
  }

  async globalStats(): Promise<{ guilds: number; commands: number; securityEvents: number }> {
    const guilds = await this.db.queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM guilds');
    const commands = await this.db.queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM custom_commands WHERE enabled = TRUE",
    );
    const events = await this.db.queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM security_events');
    return {
      guilds: Number(guilds?.count ?? '0'),
      commands: Number(commands?.count ?? '0'),
      securityEvents: Number(events?.count ?? '0'),
    };
  }
}
