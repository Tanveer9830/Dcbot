import { EmbedBuilder } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import { DEFAULTS, levelProgress, rollMessageXp } from '@dcbot/shared';
import { formatNumber, progressBar } from '../utils/format.js';

export interface LevelingConfig {
  enabled: boolean;
  xpMin: number;
  xpMax: number;
  cooldownSeconds: number;
  announceLevelUp: boolean;
  announceChannelId: string | null;
  multiplier: number;
  exemptChannelIds: string[];
  rankCardEnabled: boolean;
}

export const DEFAULT_LEVELING: LevelingConfig = {
  enabled: true,
  xpMin: DEFAULTS.XP_PER_MESSAGE_MIN,
  xpMax: DEFAULTS.XP_PER_MESSAGE_MAX,
  cooldownSeconds: 60,
  announceLevelUp: true,
  announceChannelId: null,
  multiplier: 1,
  exemptChannelIds: [],
  rankCardEnabled: true,
};

export class LevelingService {
  constructor(private readonly repos: Repositories) {}

  async config(guildId: string): Promise<LevelingConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_LEVELING, ...((settings.leveling ?? {}) as Partial<LevelingConfig>) };
  }

  async update(guildId: string, patch: Partial<LevelingConfig>): Promise<LevelingConfig> {
    const config = { ...(await this.config(guildId)), ...patch };
    config.xpMin = Math.max(0, Math.min(500, Math.floor(config.xpMin)));
    config.xpMax = Math.max(config.xpMin, Math.min(1000, Math.floor(config.xpMax)));
    config.cooldownSeconds = Math.max(5, Math.min(3600, Math.floor(config.cooldownSeconds)));
    config.multiplier = Math.max(0.1, Math.min(10, config.multiplier));
    await this.repos.guilds.updateSettingsGroup(guildId, 'leveling', config as unknown as Record<string, unknown>);
    return config;
  }

  /** Awards XP for a message; the repository enforces the cooldown. */
  async onMessage(params: {
    guildId: string;
    userId: string;
    channelId: string;
    contentLength: number;
    random?: () => number;
  }) {
    const config = await this.config(params.guildId);
    if (!config.enabled) return null;
    if (config.exemptChannelIds.includes(params.channelId)) return null;
    // Messages under 3 characters award nothing: blocks "." spam farming.
    if (params.contentLength < 3) return null;

    const rolled = rollMessageXp(config.xpMin, config.xpMax, params.random);
    return this.repos.leveling.awardXp({
      guildId: params.guildId,
      userId: params.userId,
      amount: rolled,
      multiplier: config.multiplier,
    });
  }

  async rankEmbed(guildId: string, userId: string, displayName: string, avatarUrl: string | null): Promise<EmbedBuilder> {
    const profile = await this.repos.leveling.getProfile(guildId, userId);
    const rank = await this.repos.leveling.rankOf(guildId, userId);
    const progress = levelProgress(profile.xp);
    return new EmbedBuilder()
      .setTitle(`${displayName}'s rank`)
      .setThumbnail(avatarUrl)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Level', value: String(progress.level), inline: true },
        { name: 'Rank', value: rank ? `#${rank}` : 'Unranked', inline: true },
        { name: 'Total XP', value: formatNumber(profile.xp), inline: true },
        {
          name: 'Progress',
          value: `${progressBar(progress.percent, 12)} ${Math.round(progress.percent * 100)}%\n${formatNumber(
            progress.xpIntoLevel,
          )} / ${formatNumber(progress.nextLevelXp - progress.currentLevelXp)} XP`,
        },
      );
  }

  async leaderboard(guildId: string, limit = 10) {
    const rows = await this.repos.leveling.leaderboard(guildId, limit);
    return rows.map((row) => ({
      rank: row.rank,
      userId: row.userId,
      level: row.level,
      xp: row.xp,
      label: `${row.rank}. <@${row.userId}> - level ${row.level} (${formatNumber(row.xp)} XP)`,
    }));
  }
}
