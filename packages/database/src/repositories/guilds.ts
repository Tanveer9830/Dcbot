import type { Queryable } from '../client.js';

export interface GuildRow {
  guild_id: string;
  name: string | null;
  owner_id: string | null;
  member_count: number | null;
  bot_joined_at: Date;
  updated_at: Date;
}

export interface GuildSettingsRow {
  guild_id: string;
  moderation: Record<string, unknown>;
  automod: Record<string, unknown>;
  security: Record<string, unknown>;
  tickets: Record<string, unknown>;
  welcome: Record<string, unknown>;
  logging: Record<string, unknown>;
  economy: Record<string, unknown>;
  leveling: Record<string, unknown>;
  music: Record<string, unknown>;
  branding: Record<string, unknown>;
  no_tag: Record<string, unknown>;
  no_pin: Record<string, unknown>;
  suggestions: Record<string, unknown>;
  giveaways: Record<string, unknown>;
  reaction_roles: Record<string, unknown>;
  updated_at: Date;
}

export type SettingsGroup = Exclude<keyof GuildSettingsRow, 'guild_id' | 'updated_at'>;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  'moderation',
  'automod',
  'security',
  'tickets',
  'welcome',
  'logging',
  'economy',
  'leveling',
  'music',
  'branding',
  'no_tag',
  'no_pin',
  'suggestions',
  'giveaways',
  'reaction_roles',
] as const;

export function isSettingsGroup(value: string): value is SettingsGroup {
  return (SETTINGS_GROUPS as readonly string[]).includes(value);
}

export class GuildRepository {
  constructor(private readonly db: Queryable) {}

  async upsertGuild(params: {
    guildId: string;
    name?: string | null;
    ownerId?: string | null;
    memberCount?: number | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO guilds (guild_id, name, owner_id, member_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, guilds.name),
         owner_id = COALESCE(EXCLUDED.owner_id, guilds.owner_id),
         member_count = COALESCE(EXCLUDED.member_count, guilds.member_count),
         updated_at = now()`,
      [params.guildId, params.name ?? null, params.ownerId ?? null, params.memberCount ?? null],
    );
    await this.db.query(
      `INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
      [params.guildId],
    );
  }

  async getGuild(guildId: string): Promise<GuildRow | null> {
    const result = await this.db.query<GuildRow>('SELECT * FROM guilds WHERE guild_id = $1', [
      guildId,
    ]);
    return result.rows[0] ?? null;
  }

  async listGuilds(limit = 100, offset = 0): Promise<GuildRow[]> {
    const result = await this.db.query<GuildRow>(
      'SELECT * FROM guilds ORDER BY name NULLS LAST LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows;
  }

  async getSettings(guildId: string): Promise<GuildSettingsRow> {
    const result = await this.db.query<GuildSettingsRow>(
      'SELECT * FROM guild_settings WHERE guild_id = $1',
      [guildId],
    );
    const row = result.rows[0];
    if (row) return row;
    await this.db.query(
      'INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
      [guildId],
    );
    await this.db.query(
      'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
      [guildId],
    );
    const fresh = await this.db.query<GuildSettingsRow>(
      'SELECT * FROM guild_settings WHERE guild_id = $1',
      [guildId],
    );
    // When the guild row is absent the insert above fails on FK; fall back to defaults.
    return (
      fresh.rows[0] ??
      ({
        guild_id: guildId,
        updated_at: new Date(),
        ...Object.fromEntries(SETTINGS_GROUPS.map((group) => [group, {}])),
      } as unknown as GuildSettingsRow)
    );
  }

  /**
   * Merges a patch into one settings group. Uses jsonb concat so callers only
   * send the keys they change, and validates the group name against the
   * allowlist to keep the column name from being attacker controlled.
   */
  async updateSettingsGroup(
    guildId: string,
    group: SettingsGroup,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (!isSettingsGroup(group)) {
      throw new Error(`Unknown settings group: ${group}`);
    }
    await this.db.query(
      `INSERT INTO guild_settings (guild_id, ${group})
         VALUES ($1, $2::jsonb)
         ON CONFLICT (guild_id) DO UPDATE SET
           ${group} = guild_settings.${group} || EXCLUDED.${group},
           updated_at = now()`,
      [guildId, JSON.stringify(patch)],
    );
  }
}
