import { EmbedBuilder } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import { DEFAULTS, levelProgress, ValidationError } from '@dcbot/shared';
import { formatNumber } from '../utils/format.js';

export interface EconomyConfig {
  enabled: boolean;
  currencyName: string;
  currencySymbol: string;
  dailyMin: number;
  dailyMax: number;
  weeklyMin: number;
  weeklyMax: number;
  workMin: number;
  workMax: number;
  startingBalance: number;
  transfersEnabled: boolean;
  minimumTransfer: number;
  transferFeePercent: number;
  levelUpReward: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  enabled: true,
  currencyName: 'coins',
  currencySymbol: '🪙',
  dailyMin: DEFAULTS.ECONOMY_DAILY_MIN,
  dailyMax: DEFAULTS.ECONOMY_DAILY_MAX,
  weeklyMin: DEFAULTS.ECONOMY_WEEKLY_MIN,
  weeklyMax: DEFAULTS.ECONOMY_WEEKLY_MAX,
  workMin: 100,
  workMax: 400,
  startingBalance: DEFAULTS.ECONOMY_STARTING_BALANCE,
  transfersEnabled: true,
  minimumTransfer: 50,
  transferFeePercent: 0,
  levelUpReward: 0,
};

/** Virtual game economy only. No real money, no cash-out, no gambling stake. */
export class EconomyService {
  constructor(private readonly repos: Repositories) {}

  async config(guildId: string): Promise<EconomyConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_ECONOMY, ...((settings.economy ?? {}) as Partial<EconomyConfig>) };
  }

  async update(guildId: string, patch: Partial<EconomyConfig>): Promise<EconomyConfig> {
    const config = { ...(await this.config(guildId)), ...patch };
    config.dailyMin = clamp(config.dailyMin, 0, 1_000_000);
    config.dailyMax = Math.max(config.dailyMin, clamp(config.dailyMax, 0, 1_000_000));
    config.weeklyMin = clamp(config.weeklyMin, 0, 10_000_000);
    config.weeklyMax = Math.max(config.weeklyMin, clamp(config.weeklyMax, 0, 10_000_000));
    config.workMin = clamp(config.workMin, 0, 1_000_000);
    config.workMax = Math.max(config.workMin, clamp(config.workMax, 0, 1_000_000));
    config.transferFeePercent = clamp(config.transferFeePercent, 0, 25);
    await this.repos.guilds.updateSettingsGroup(guildId, 'economy', config as unknown as Record<string, unknown>);
    return config;
  }

  async balance(guildId: string, userId: string) {
    const config = await this.config(guildId);
    const account = await this.repos.economy.getAccount(guildId, userId);
    return { account, config };
  }

  async claim(guildId: string, userId: string, kind: 'daily' | 'weekly' | 'work', random: () => number = Math.random) {
    const config = await this.config(guildId);
    if (!config.enabled) throw new ValidationError('The economy is disabled in this server.');
    const range =
      kind === 'daily'
        ? [config.dailyMin, config.dailyMax]
        : kind === 'weekly'
          ? [config.weeklyMin, config.weeklyMax]
          : [config.workMin, config.workMax];
    const amount = range[0]! + Math.floor(random() * Math.max(1, range[1]! - range[0]! + 1));
    return this.repos.economy.claimTimedReward({ guildId, userId, kind, amount });
  }

  async pay(params: {
    guildId: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    memo?: string;
    idempotencyKey?: string;
  }) {
    const config = await this.config(params.guildId);
    if (!config.transfersEnabled) throw new ValidationError('Transfers are disabled in this server.');
    if (params.amount < config.minimumTransfer) {
      throw new ValidationError(`The minimum transfer is ${config.minimumTransfer} ${config.currencyName}.`);
    }
    return this.repos.economy.transfer(params);
  }

  async leaderboard(guildId: string, limit = 10) {
    const rows = await this.repos.economy.leaderboard(guildId, limit);
    const config = await this.config(guildId);
    return rows.map((row) => ({
      rank: row.rank,
      userId: row.userId,
      total: row.wallet + row.bank,
      label: `${row.rank}. <@${row.userId}> - ${formatNumber(row.wallet + row.bank)} ${config.currencyName}`,
    }));
  }

  /** Balance embed used by /economy balance and /profile. */
  async balanceEmbed(guildId: string, userId: string): Promise<EmbedBuilder> {
    const { account, config } = await this.balance(guildId, userId);
    const xpProfile = await this.repos.leveling.getProfile(guildId, userId);
    const progress = levelProgress(xpProfile.xp);
    return new EmbedBuilder()
      .setTitle(`${config.currencySymbol} ${userId === '' ? 'Balance' : `<@${userId}>'s profile`}`)
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Wallet', value: `${formatNumber(account.wallet)} ${config.currencyName}`, inline: true },
        { name: 'Bank', value: `${formatNumber(account.bank)} ${config.currencyName}`, inline: true },
        { name: 'Total', value: formatNumber(account.wallet + account.bank), inline: true },
        { name: 'Level', value: `${progress.level}`, inline: true },
        { name: 'XP', value: formatNumber(xpProfile.xp), inline: true },
        { name: 'Messages', value: formatNumber(xpProfile.messages), inline: true },
      );
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
