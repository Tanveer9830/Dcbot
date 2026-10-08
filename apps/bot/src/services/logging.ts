import { ChannelType, EmbedBuilder, type Guild, type TextChannel } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import type { Logger } from '../utils/logger.js';

export type LogChannelKey =
  'moderation' | 'security' | 'messages' | 'members' | 'tickets' | 'economy' | 'errors';

export interface LoggingConfig {
  enabled: boolean;
  channels: Partial<Record<LogChannelKey, string>>;
  events: Record<string, boolean>;
}

export const DEFAULT_LOGGING: LoggingConfig = {
  enabled: false,
  channels: {},
  events: {
    moderation: true,
    security: true,
    message_delete: true,
    message_edit: true,
    member_join: true,
    member_leave: true,
    role_change: true,
    ticket: true,
    economy: false,
    errors: true,
  },
};

/**
 * Log dispatcher.
 *
 * Honesty rules encoded here:
 *  - message content is only logged when the bot actually saw the message
 *    (it must be in cache or fetched successfully). Nothing is invented.
 *  - a missing/unwritable log channel downgrades to a debug line, never a crash.
 */
export class LoggingService {
  constructor(
    private readonly repos: Repositories,
    private readonly logger: Logger,
  ) {}

  async config(guildId: string): Promise<LoggingConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    const stored = (settings.logging ?? {}) as Partial<LoggingConfig>;
    return {
      enabled: stored.enabled ?? DEFAULT_LOGGING.enabled,
      channels: { ...DEFAULT_LOGGING.channels, ...(stored.channels ?? {}) },
      events: { ...DEFAULT_LOGGING.events, ...(stored.events ?? {}) },
    };
  }

  async setChannel(guildId: string, key: LogChannelKey, channelId: string): Promise<void> {
    const config = await this.config(guildId);
    config.channels[key] = channelId;
    await this.repos.guilds.updateSettingsGroup(guildId, 'logging', { channels: config.channels });
  }

  async setEvent(guildId: string, event: string, enabled: boolean): Promise<void> {
    const config = await this.config(guildId);
    config.events[event] = enabled;
    await this.repos.guilds.updateSettingsGroup(guildId, 'logging', { events: config.events });
  }

  async setEnabled(guildId: string, enabled: boolean): Promise<void> {
    await this.repos.guilds.updateSettingsGroup(guildId, 'logging', { enabled });
  }

  /** Sends an embed to the configured channel for `key`, if any. */
  async send(
    guild: Guild,
    key: LogChannelKey,
    build: () => EmbedBuilder,
    options: { event?: string } = {},
  ): Promise<boolean> {
    const config = await this.config(guild.id);
    if (!config.enabled) return false;
    if (options.event && config.events[options.event] === false) return false;
    const channelId = config.channels[key];
    if (!channelId) return false;

    const channel = guild.channels.cache.get(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      this.logger.debug('logging: configured channel unavailable', {
        guildId: guild.id,
        key,
        channelId,
      });
      return false;
    }
    try {
      await (channel as TextChannel).send({ embeds: [build()] });
      return true;
    } catch (error) {
      this.logger.warn('logging: failed to send', {
        guildId: guild.id,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
