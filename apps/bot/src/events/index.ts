import { EmbedBuilder, Events, type Client } from 'discord.js';
import type { BotContext, BotEvent } from '../types.js';
import { ThrottledLogger } from '../utils/logger.js';

export function registerEvents(client: Client, ctx: BotContext): string[] {
  const registered: string[] = [];
  const throttled = new ThrottledLogger(ctx.logger, 60_000);

  client.once(Events.ClientReady, async (readyClient) => {
    ctx.logger.info('bot ready', {
      user: readyClient.user?.tag ?? 'unknown',
      guilds: readyClient.guilds.cache.size,
      shardCount: readyClient.options.shardCount ?? 1,
    });
    // Persist guild membership so the dashboard has real data.
    if (ctx.repos) {
      for (const guild of readyClient.guilds.cache.values()) {
        await ctx.repos.guilds
          .upsertGuild({
            guildId: guild.id,
            name: guild.name,
            ownerId: guild.ownerId,
            memberCount: guild.memberCount,
          })
          .catch(() => undefined);
      }
    }
    registered.push('ready');
  });

  client.on(Events.Error, (error) => {
    ctx.logger.error('client error', { error: error.message, stack: error.stack });
  });

  client.on(Events.Warn, (message) => {
    throttled.warn('client', message);
  });

  client.on(Events.ShardReady, (id) => {
    ctx.logger.info('shard ready', { shardId: id });
  });

  client.on(Events.ShardDisconnect, (_event, id) => {
    ctx.logger.warn('shard disconnected', { shardId: id });
  });

  client.on(Events.ShardReconnecting, (id) => {
    ctx.logger.info('shard reconnecting', { shardId: id });
  });

  client.on(Events.GuildUnavailable, (guild) => {
    throttled.warn('guild', `guild unavailable: ${guild.id}`);
  });

  return registered;
}

/** Shared embed used by error responses. */
export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${message}`);
}

export type { BotEvent };
