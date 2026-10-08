import { ChannelType, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { defineCommand, requireService, successEmbed, ValidationError } from '../helpers.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const ticket = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Support ticket system.')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configures the ticket system.')
        .addChannelOption((option) =>
          option.setName('category').setDescription('Category for ticket channels'),
        )
        .addChannelOption((option) =>
          option.setName('logs').setDescription('Channel for ticket logs'),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_open')
            .setDescription('Open tickets per user')
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('staff')
        .setDescription('Adds or removes a staff role for tickets.')
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true))
        .addBooleanOption((option) =>
          option.setName('remove').setDescription('Remove instead of add'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Posts the support panel in a channel.')
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Channel to post in').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('close').setDescription('Closes this ticket.'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claims this ticket.'))
    .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopens this ticket.'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Adds a member to this ticket.')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member to add').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a member from this ticket.')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member to remove').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('transcript').setDescription('Shows the recorded transcript of this ticket.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rate')
        .setDescription('Rates the support you received.')
        .addIntegerOption((option) =>
          option
            .setName('stars')
            .setDescription('1-5')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists open tickets (staff only).')),
  description: 'Support ticket system.',
  async execute(ctx) {
    const service = requireService(ctx.context.services.tickets, 'tickets');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const config = await service.config(ctx.guild.id);
    const staff =
      config.staffRoleIds.some((role) => ctx.member.roles.cache.has(role)) ||
      ctx.member.permissions.has('ManageGuild');

    if (sub === 'setup') {
      if (!staff) throw new ValidationError('Only server staff can configure tickets.');
      const category = ctx.interaction.options.getChannel('category');
      const logs = ctx.interaction.options.getChannel('logs');
      const maxOpen = ctx.interaction.options.getInteger('max_open');
      const updated = await service.update(ctx.guild.id, {
        enabled: true,
        ...(category ? { categoryId: category.id } : {}),
        ...(logs ? { logChannelId: logs.id } : {}),
        ...(maxOpen ? { maxOpenPerUser: maxOpen } : {}),
      });
      await ctx.reply({
        embeds: [successEmbed(`Tickets configured. Max open per user: ${updated.maxOpenPerUser}.`)],
      });
      return;
    }

    if (sub === 'staff') {
      if (!staff) throw new ValidationError('Only server staff can manage ticket staff roles.');
      const role = ctx.interaction.options.getRole('role', true);
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      const roles = remove
        ? config.staffRoleIds.filter((id) => id !== role.id)
        : [...new Set([...config.staffRoleIds, role.id])];
      await service.update(ctx.guild.id, { staffRoleIds: roles });
      await ctx.reply({ embeds: [successEmbed('Ticket staff roles updated.')] });
      return;
    }

    if (sub === 'panel') {
      if (!staff) throw new ValidationError('Only server staff can post the panel.');
      const channel = ctx.interaction.options.getChannel('channel', true);
      if (channel.type !== ChannelType.GuildText)
        throw new ValidationError('Choose a text channel.');
      await service.postPanel(ctx.guild, channel as TextChannel);
      await ctx.reply({
        embeds: [successEmbed(`Panel posted in <#${channel.id}>.`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'close') {
      await service.close({
        guild: ctx.guild,
        channelId: ctx.interaction.channelId,
        closedById: ctx.interaction.user.id,
      });
      return;
    }

    if (sub === 'claim') {
      const message = await service.claim(
        ctx.guild,
        ctx.interaction.channelId,
        ctx.interaction.user.id,
      );
      await ctx.reply({ content: message });
      return;
    }

    if (sub === 'reopen') {
      if (!staff) throw new ValidationError('Only staff can reopen tickets.');
      const message = await service.reopen(ctx.guild, ctx.interaction.channelId);
      await ctx.reply({ content: message });
      return;
    }

    if (sub === 'add' || sub === 'remove') {
      const target = ctx.interaction.options.getUser('user', true);
      const channel = ctx.interaction.channel;
      if (!channel || !('permissionOverwrites' in channel))
        throw new ValidationError('This is not a ticket channel.');
      await channel.permissionOverwrites.edit(target.id, {
        ViewChannel: sub === 'add' ? true : false,
        SendMessages: sub === 'add' ? true : false,
      });
      await ctx.reply({
        content: `${target} ${sub === 'add' ? 'added to' : 'removed from'} this ticket.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'transcript') {
      const text = await service.transcript(
        ctx.guild.id,
        ctx.interaction.channelId,
        ctx.interaction.user.id,
        ctx.context.owners.isOwner(ctx.interaction.user.id),
        config.staffRoleIds,
        [...ctx.member.roles.cache.keys()],
      );
      await ctx.reply({ content: text.slice(0, 1900), ephemeral: true });
      return;
    }

    if (sub === 'rate') {
      const message = await service.rate(
        ctx.guild.id,
        ctx.interaction.channelId,
        ctx.interaction.user.id,
        ctx.interaction.options.getInteger('stars', true),
      );
      await ctx.reply({ content: message, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      if (!staff) throw new ValidationError('Only staff can list tickets.');
      const rows = await repos.tickets.list(ctx.guild.id, undefined, 20);
      await ctx.reply({
        embeds: [
          {
            title: `Tickets (${rows.length})`,
            color: 0x5865f2,
            description:
              rows
                .map(
                  (row) =>
                    `\`${row.id}\` <#${row.channelId}> - **${row.status}** by <@${row.openerId}>${row.rating ? ` ⭐${row.rating}` : ''}`,
                )
                .join('\n')
                .slice(0, 4000) || '_none_',
          },
        ],
        ephemeral: true,
      });
    }
  },
});

export default [ticket];
export { PERMISSION_BIT };
