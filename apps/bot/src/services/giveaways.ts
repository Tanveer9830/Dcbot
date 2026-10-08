import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import { ValidationError } from '@dcbot/shared';
import { discordTimestamp } from '../utils/format.js';
import type { Logger } from '../utils/logger.js';

export class GiveawayService {
  constructor(
    private readonly repos: Repositories,
    private readonly logger: Logger,
  ) {}

  async start(params: {
    guild: Guild;
    channel: TextChannel;
    hostId: string;
    prize: string;
    winnerCount: number;
    durationMs: number;
  }): Promise<{ messageId: string; endsAt: Date }> {
    if (params.prize.trim().length === 0) throw new ValidationError('Prize is required.');
    if (params.winnerCount < 1 || params.winnerCount > 25) {
      throw new ValidationError('Winner count must be between 1 and 25.');
    }
    if (params.durationMs < 60_000)
      throw new ValidationError('Duration must be at least 1 minute.');

    const endsAt = new Date(Date.now() + params.durationMs);
    const embed = new EmbedBuilder()
      .setTitle('🎉 Giveaway')
      .setDescription(`**Prize:** ${params.prize}`)
      .addFields(
        { name: 'Winners', value: String(params.winnerCount), inline: true },
        { name: 'Ends', value: discordTimestamp(endsAt, 'R'), inline: true },
        { name: 'Host', value: `<@${params.hostId}>`, inline: true },
        { name: 'Entries', value: '0', inline: true },
      )
      .setColor(0xf1c40f)
      .setTimestamp(endsAt);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel('Enter')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Primary),
    );
    const message = await params.channel.send({ embeds: [embed], components: [row] });
    await this.repos.community.createGiveaway({
      guildId: params.guild.id,
      channelId: params.channel.id,
      messageId: message.id,
      hostId: params.hostId,
      prize: params.prize,
      winnerCount: params.winnerCount,
      endsAt,
    });
    return { messageId: message.id, endsAt };
  }

  async enter(
    guildId: string,
    messageId: string,
    userId: string,
  ): Promise<{ entered: boolean; total: number }> {
    const active = await this.repos.community.activeGiveaways(guildId);
    const giveaway = active.find((entry) => entry.messageId === messageId);
    if (!giveaway) throw new ValidationError('That giveaway is not active.');
    const entered = await this.repos.community.enter(giveaway.id, userId);
    const total = (await this.repos.community.entrants(giveaway.id)).length;
    return { entered, total };
  }

  /** Ends a giveaway and announces winners. Uses an injectable RNG. */
  async end(guild: Guild, messageId: string, random: () => number = Math.random): Promise<string> {
    const active = await this.repos.community.activeGiveaways(guild.id);
    const giveaway = active.find((entry) => entry.messageId === messageId);
    if (!giveaway) throw new ValidationError('That giveaway is not active.');
    const entrants = await this.repos.community.entrants(giveaway.id);
    const { winners, marked } = await this.repos.community.finishGiveaway(
      giveaway.id,
      entrants,
      giveaway.winnerCount,
      random,
    );
    if (!marked) return 'That giveaway was already ended.';

    const channel = guild.channels.cache.get(giveaway.channelId) as TextChannel | undefined;
    const description =
      winners.length > 0
        ? `**Prize:** ${giveaway.prize}\n**Winner(s):** ${winners.map((id) => `<@${id}>`).join(', ')}`
        : `**Prize:** ${giveaway.prize}\nNo valid entries.`;
    const embed = new EmbedBuilder()
      .setTitle('🎉 Giveaway ended')
      .setDescription(description)
      .setColor(0x57f287);
    if (channel) {
      await channel
        .send({ content: winners.map((id) => `<@${id}>`).join(' ') || undefined, embeds: [embed] })
        .catch((error) => {
          this.logger.warn('giveaway: announcement failed', {
            guildId: guild.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    return winners.length > 0 ? `Winner(s): ${winners.join(', ')}` : 'No entries.';
  }

  /** Sweeps due giveaways. Called by the automation loop. */
  async sweepDue(guildResolver: (guildId: string) => Guild | null): Promise<number> {
    const due = await this.repos.community.dueGiveaways();
    let finished = 0;
    for (const giveaway of due) {
      const guild = guildResolver(giveaway.guildId);
      if (!guild) continue;
      await this.end(guild, giveaway.messageId).catch((error) => {
        this.logger.warn('giveaway: sweep failed', {
          guildId: giveaway.guildId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      finished += 1;
    }
    return finished;
  }
}
