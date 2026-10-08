import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import { AuthorizationError, ValidationError } from '@dcbot/shared';
import type { Logger } from '../utils/logger.js';

export interface TicketConfig {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  logChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  maxOpenPerUser: number;
  closeConfirmation: boolean;
  autoCloseHours: number | null;
  ratingEnabled: boolean;
  categories: Array<{ id: string; label: string; roleId: string | null }>;
}

export const DEFAULT_TICKETS: TicketConfig = {
  enabled: false,
  categoryId: null,
  staffRoleIds: [],
  logChannelId: null,
  panelChannelId: null,
  panelMessageId: null,
  maxOpenPerUser: 1,
  closeConfirmation: true,
  autoCloseHours: null,
  ratingEnabled: true,
  categories: [],
};

export class TicketService {
  constructor(
    private readonly repos: Repositories,
    private readonly logger: Logger,
  ) {}

  async config(guildId: string): Promise<TicketConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_TICKETS, ...((settings.tickets ?? {}) as Partial<TicketConfig>) };
  }

  async update(guildId: string, patch: Partial<TicketConfig>): Promise<TicketConfig> {
    const config = { ...(await this.config(guildId)), ...patch };
    config.maxOpenPerUser = Math.max(1, Math.min(10, config.maxOpenPerUser));
    await this.repos.guilds.updateSettingsGroup(guildId, 'tickets', config as unknown as Record<string, unknown>);
    return config;
  }

  /** Posts (or refreshes) the support panel with an Open Ticket button. */
  async postPanel(guild: Guild, channel: TextChannel, category?: string): Promise<string> {
    const embed = new EmbedBuilder()
      .setTitle('Support')
      .setDescription('Click the button below to open a private ticket with the staff team.')
      .setColor(0x5865f2);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_open${category ? `:${category}` : ''}`)
        .setLabel('Open Ticket')
        .setEmoji('📩')
        .setStyle(ButtonStyle.Primary),
    );
    const message = await channel.send({ embeds: [embed], components: [row] });
    await this.update(guild.id, {
      enabled: true,
      panelChannelId: channel.id,
      panelMessageId: message.id,
    });
    return message.id;
  }

  async open(params: {
    guild: Guild;
    openerId: string;
    reason?: string;
    category?: string;
  }): Promise<{ channelId: string; created: boolean; message: string }> {
    const config = await this.config(params.guild.id);
    const openCount = await this.repos.tickets.countOpenByUser(params.guild.id, params.openerId);
    if (openCount >= config.maxOpenPerUser) {
      throw new ValidationError(`You already have ${openCount} open ticket(s). Close one first.`);
    }

    const permissions = [
      { id: params.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: params.openerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      {
        id: params.guild.members.me!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...config.staffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ];

    const channel = await params.guild.channels.create({
      name: `ticket-${params.openerId.slice(-5)}`,
      type: ChannelType.GuildText,
      ...(config.categoryId ? { parent: config.categoryId } : {}),
      permissionOverwrites: permissions,
      reason: `Ticket opened by ${params.openerId}`,
      topic: `Ticket for <@${params.openerId}>${params.reason ? ` - ${params.reason}` : ''}`,
    });

    await this.repos.tickets.create({
      guildId: params.guild.id,
      channelId: channel.id,
      openerId: params.openerId,
      category: params.category ?? null,
      reason: params.reason ?? null,
    });

    const embed = new EmbedBuilder()
      .setTitle('Ticket opened')
      .setDescription(
        `Hello <@${params.openerId}>, a staff member will be with you shortly.${
          params.reason ? `\n\n**Reason:** ${params.reason}` : ''
        }`,
      )
      .setColor(0x57f287);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
    );
    await channel.send({ content: `<@${params.openerId}>`, embeds: [embed], components: [row] });
    await this.logTicket(params.guild, config, `Ticket opened by <@${params.openerId}> in <#${channel.id}>`);
    return { channelId: channel.id, created: true, message: `Ticket created: <#${channel.id}>` };
  }

  async claim(guild: Guild, channelId: string, staffId: string): Promise<string> {
    const ticket = await this.repos.tickets.claim(guild.id, channelId, staffId);
    if (!ticket) throw new ValidationError('That ticket is not open (already claimed or closed).');
    const config = await this.config(guild.id);
    await this.logTicket(guild, config, `Ticket <#${channelId}> claimed by <@${staffId}>`);
    return `Ticket claimed by <@${staffId}>.`;
  }

  async close(params: {
    guild: Guild;
    channelId: string;
    closedById: string;
    deleteChannel?: boolean;
  }): Promise<string> {
    const ticket = await this.repos.tickets.close(params.guild.id, params.channelId);
    if (!ticket) throw new ValidationError('That ticket is already closed.');
    const config = await this.config(params.guild.id);
    await this.logTicket(
      params.guild,
      config,
      `Ticket <#${params.channelId}> closed by <@${params.closedById}> (opener <@${ticket.openerId}>)`,
    );
    const channel = params.guild.channels.cache.get(params.channelId) as TextChannel | undefined;
    if (channel) {
      await channel
        .send({ content: `Ticket closed by <@${params.closedById}>. This channel will be deleted shortly.` })
        .catch(() => undefined);
      if (params.deleteChannel !== false) {
        await channel.delete('Ticket closed').catch(() => undefined);
      }
    }
    return 'Ticket closed.';
  }

  async reopen(guild: Guild, channelId: string): Promise<string> {
    const ticket = await this.repos.tickets.reopen(guild.id, channelId);
    if (!ticket) throw new ValidationError('That ticket is not closed.');
    return 'Ticket reopened.';
  }

  async rate(guildId: string, channelId: string, userId: string, rating: number): Promise<string> {
    const ticket = await this.repos.tickets.getByChannel(guildId, channelId);
    if (!ticket) throw new ValidationError('No ticket exists for this channel.');
    if (ticket.openerId !== userId) {
      throw new AuthorizationError('Only the person who opened the ticket can rate it.');
    }
    await this.repos.tickets.rate(guildId, channelId, rating);
    return `Thanks for the feedback (${rating}/5).`;
  }

  /**
   * Builds a transcript. Access is enforced BEFORE the content is read: the
   * caller must be the opener, the claiming staff member, or a bot owner.
   */
  async transcript(guildId: string, channelId: string, requesterId: string, isOwner: boolean, staffRoleIds: readonly string[], roleIds: readonly string[]): Promise<string> {
    const ticket = await this.repos.tickets.getByChannel(guildId, channelId);
    if (!ticket) throw new ValidationError('No ticket exists for this channel.');
    const isOpener = ticket.openerId === requesterId;
    const isClaimer = ticket.claimedById === requesterId;
    const isStaff = staffRoleIds.some((role) => roleIds.includes(role));
    if (!isOwner && !isOpener && !isClaimer && !isStaff) {
      throw new AuthorizationError('You are not authorised to view this transcript.');
    }
    const rows = await this.repos.tickets.transcript(ticket.id);
    if (rows.length === 0) return '_This ticket has no recorded messages._';
    return rows
      .map((row) => `[${row.createdAt.toISOString()}] <@${row.authorId}>: ${row.content || '(no text content)'}`)
      .join('\n');
  }

  /** Stores a message for the transcript. Content is only stored when present. */
  async recordMessage(params: {
    guildId: string;
    channelId: string;
    authorId: string;
    authorIsBot: boolean;
    content: string;
    attachmentCount: number;
  }): Promise<void> {
    const ticket = await this.repos.tickets.getByChannel(params.guildId, params.channelId);
    if (!ticket) return;
    try {
      await this.repos.tickets.appendMessage({
        ticketId: ticket.id,
        authorId: params.authorId,
        authorIsBot: params.authorIsBot,
        content: params.content,
        attachmentCount: params.attachmentCount,
      });
    } catch (error) {
      this.logger.debug('tickets: failed to record transcript row', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async logTicket(guild: Guild, config: TicketConfig, message: string): Promise<void> {
    if (!config.logChannelId) return;
    const channel = guild.channels.cache.get(config.logChannelId) as TextChannel | undefined;
    if (!channel) return;
    await channel.send({ embeds: [new EmbedBuilder().setDescription(message).setColor(0x5865f2).setTimestamp()] }).catch(() => undefined);
  }
}
