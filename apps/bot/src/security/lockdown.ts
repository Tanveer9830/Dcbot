import { ChannelType, PermissionFlagsBits, type Guild, type NewsChannel, type TextChannel } from 'discord.js';

/** Channels that carry per-channel permission overwrites. */
type LockableChannel = TextChannel | NewsChannel;
import type { Logger } from '../utils/logger.js';

export interface LockdownResult {
  locked: string[];
  failed: Array<{ channelId: string; reason: string }>;
}

/**
 * Emergency lockdown.
 *
 * Removes @everyone's Send Messages permission from every text channel and
 * stores the previous deny state so `unlock` can restore it exactly. This is
 * reversible; it does not claim to undo anything Discord has already delivered.
 */
export class LockdownManager {
  private readonly previous = new Map<string, { allow: bigint; deny: bigint }>();

  constructor(private readonly logger: Logger) {}

  isLocked(guildId: string): boolean {
    return [...this.previous.keys()].some((key) => key.startsWith(`${guildId}:`));
  }

  lockedChannels(guildId: string): string[] {
    return [...this.previous.keys()]
      .filter((key) => key.startsWith(`${guildId}:`))
      .map((key) => key.split(':')[1]!);
  }

  async lock(guild: Guild, options: { channelIds?: string[]; reason: string }): Promise<LockdownResult> {
    const result: LockdownResult = { locked: [], failed: [] };
    const channels = options.channelIds?.length
      ? options.channelIds
          .map((id) => guild.channels.cache.get(id))
          .filter((channel): channel is LockableChannel => Boolean(channel))
      : guild.channels.cache.filter(
          (channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement,
        );

    for (const channel of Array.from(channels as Iterable<LockableChannel>)) {
      try {
        const everyone = guild.roles.everyone.id;
        const existing = channel.permissionOverwrites.cache.get(everyone);
        if (existing) {
          this.previous.set(`${guild.id}:${channel.id}`, {
            allow: existing.allow.bitfield,
            deny: existing.deny.bitfield,
          });
        }
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          AddReactions: false,
        });
        result.locked.push(channel.id);
      } catch (error) {
        result.failed.push({
          channelId: channel.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        this.logger.warn('lockdown: failed to lock channel', {
          guildId: guild.id,
          channelId: channel.id,
        });
      }
    }
    return result;
  }

  async unlock(guild: Guild): Promise<LockdownResult> {
    const result: LockdownResult = { locked: [], failed: [] };
    for (const [key, state] of this.previous) {
      if (!key.startsWith(`${guild.id}:`)) continue;
      const channelId = key.split(':')[1]!;
      const channel = guild.channels.cache.get(channelId) as LockableChannel | undefined;
      if (!channel) {
        this.previous.delete(key);
        continue;
      }
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
          SendMessages: (state.deny & PermissionFlagsBits.SendMessages) === PermissionFlagsBits.SendMessages ? false : null,
          SendMessagesInThreads:
            (state.deny & PermissionFlagsBits.SendMessagesInThreads) === PermissionFlagsBits.SendMessagesInThreads
              ? false
              : null,
          AddReactions:
            (state.deny & PermissionFlagsBits.AddReactions) === PermissionFlagsBits.AddReactions ? false : null,
        });
        result.locked.push(channelId);
      } catch (error) {
        result.failed.push({
          channelId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      this.previous.delete(key);
    }
    return result;
  }
}
