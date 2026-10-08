import { ChannelType, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { defineCommand, requireService, successEmbed, errorEmbed, ValidationError } from '../helpers.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const config = defineCommand({
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Views and edits this server\'s configuration.')
    .addSubcommand((sub) => sub.setName('view').setDescription('Shows the current configuration.'))
    .addSubcommand((sub) =>
      sub
        .setName('export')
        .setDescription('Exports the configuration as JSON (no secrets are stored here).'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Resets one configuration group to defaults.')
        .addStringOption((option) =>
          option.setName('group').setDescription('Group').addChoices(
            { name: 'moderation', value: 'moderation' },
            { name: 'automod', value: 'automod' },
            { name: 'security', value: 'security' },
            { name: 'tickets', value: 'tickets' },
            { name: 'welcome', value: 'welcome' },
            { name: 'logging', value: 'logging' },
            { name: 'economy', value: 'economy' },
            { name: 'leveling', value: 'leveling' },
            { name: 'music', value: 'music' },
          ).setRequired(true),
        ),
    ),
  description: "Views and edits this server's configuration.",
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const settings = await repos.guilds.getSettings(ctx.guild.id);

    if (sub === 'view' || sub === 'export') {
      const summary = Object.entries(settings)
        .filter(([key]) => key !== 'guild_id' && key !== 'updated_at')
        .map(([key, value]) => `**${key}**: \`${JSON.stringify(value).slice(0, 120)}\``)
        .join('\n');
      await ctx.reply({
        content:
          sub === 'export'
            ? `\`\`\`json\n${JSON.stringify(settings, null, 2).slice(0, 1800)}\n\`\`\``
            : undefined,
        embeds: sub === 'view' ? [{ title: 'Server configuration', description: summary.slice(0, 4000), color: 0x5865f2 }] : [],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'reset') {
      const group = ctx.interaction.options.getString('group', true);
      await repos.guilds.updateSettingsGroup(ctx.guild.id, group as never, {});
      await repos.audit.record({
        guildId: ctx.guild.id,
        actorId: ctx.interaction.user.id,
        action: 'config.reset',
        targetType: 'settings_group',
        targetId: group,
      });
      await ctx.reply({ embeds: [successEmbed(`\`${group}\` reset to defaults.`)] });
    }
  },
});

const logs = defineCommand({
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configures logging channels and events.')
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Sets the channel for a log type.')
        .addStringOption((option) =>
          option.setName('type').setDescription('Log type').addChoices(
            { name: 'moderation', value: 'moderation' },
            { name: 'security', value: 'security' },
            { name: 'messages', value: 'messages' },
            { name: 'members', value: 'members' },
            { name: 'tickets', value: 'tickets' },
            { name: 'economy', value: 'economy' },
            { name: 'errors', value: 'errors' },
          ).setRequired(true),
        )
        .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('event')
        .setDescription('Enables or disables a logged event.')
        .addStringOption((option) =>
          option.setName('event').setDescription('Event').addChoices(
            { name: 'message delete', value: 'message_delete' },
            { name: 'message edit', value: 'message_edit' },
            { name: 'member join', value: 'member_join' },
            { name: 'member leave', value: 'member_leave' },
            { name: 'role change', value: 'role_change' },
            { name: 'moderation', value: 'moderation' },
            { name: 'security', value: 'security' },
          ).setRequired(true),
        )
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Turns logging on or off.')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the logging configuration.')),
  description: 'Configures logging.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const service = requireService(ctx.context.services.logging, 'logging');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'channel') {
      const type = ctx.interaction.options.getString('type', true) as 'moderation' | 'security' | 'messages' | 'members' | 'tickets' | 'economy' | 'errors';
      const channel = ctx.interaction.options.getChannel('channel', true);
      await service.setChannel(ctx.guild.id, type, channel.id);
      await ctx.reply({ embeds: [successEmbed(`${type} logs will go to <#${channel.id}>.`)] });
      return;
    }

    if (sub === 'event') {
      const event = ctx.interaction.options.getString('event', true);
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      await service.setEvent(ctx.guild.id, event, enabled);
      await ctx.reply({ embeds: [successEmbed(`\`${event}\` logging ${enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    if (sub === 'enable') {
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      await service.setEnabled(ctx.guild.id, enabled);
      await ctx.reply({ embeds: [successEmbed(`Logging ${enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    const config = await service.config(ctx.guild.id);
    await ctx.reply({
      embeds: [
        {
          title: 'Logging',
          color: 0x5865f2,
          fields: [
            { name: 'Enabled', value: String(config.enabled), inline: true },
            {
              name: 'Channels',
              value:
                Object.entries(config.channels)
                  .map(([key, id]) => `${key}: ${id ? `<#${id}>` : 'unset'}`)
                  .join('\n') || '_none set_',
            },
            {
              name: 'Events',
              value: Object.entries(config.events).map(([key, enabled]) => `${enabled ? '✅' : '⛔'} ${key}`).join('\n').slice(0, 1000),
            },
          ],
        },
      ],
      ephemeral: true,
    });
  },
});

const welcome = defineCommand({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configures welcome, leave and auto-role behaviour.')
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Sets the welcome channel.')
        .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('message')
        .setDescription('Sets the welcome message template.')
        .addStringOption((option) => option.setName('text').setDescription('Supports {{user}}, {{guild}}, {{member_count}}').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('autorole')
        .setDescription('Adds or removes an auto-assigned role.')
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true))
        .addBooleanOption((option) => option.setName('remove').setDescription('Remove instead of add')),
    )
    .addSubcommand((sub) => sub.setName('test').setDescription('Sends a test welcome message.'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the welcome configuration.')),
  description: 'Configures welcome behaviour.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const service = requireService(ctx.context.services.welcome, 'welcome');
    const sub = ctx.interaction.options.getSubcommand();
    const config = await service.config(ctx.guild.id);

    if (sub === 'channel') {
      const channel = ctx.interaction.options.getChannel('channel', true);
      await service.update(ctx.guild.id, { channelId: channel.id, enabled: true });
      await ctx.reply({ embeds: [successEmbed(`Welcome messages will go to <#${channel.id}>.`)] });
      return;
    }

    if (sub === 'message') {
      const text = ctx.interaction.options.getString('text', true);
      await service.update(ctx.guild.id, { message: text });
      await ctx.reply({ embeds: [successEmbed(`Preview: ${service.render(text, ctx.member)}`)] });
      return;
    }

    if (sub === 'autorole') {
      const role = ctx.interaction.options.getRole('role', true);
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      const roles = remove ? config.autoRoleIds.filter((id) => id !== role.id) : [...new Set([...config.autoRoleIds, role.id])];
      await service.update(ctx.guild.id, { autoRoleIds: roles });
      await ctx.reply({ embeds: [successEmbed(`Auto-roles: ${roles.map((id) => `<@&${id}>`).join(', ') || 'none'}`)] });
      return;
    }

    if (sub === 'test') {
      await ctx.reply({ content: service.render(config.message, ctx.member) });
      return;
    }

    await ctx.reply({
      embeds: [
        {
          title: 'Welcome',
          color: 0x5865f2,
          fields: [
            { name: 'Enabled', value: String(config.enabled), inline: true },
            { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'unset', inline: true },
            { name: 'Auto-roles', value: String(config.autoRoleIds.length), inline: true },
            { name: 'Leave messages', value: String(config.leaveEnabled), inline: true },
            { name: 'Message', value: config.message.slice(0, 200) },
          ],
        },
      ],
      ephemeral: true,
    });
  },
});

const verify = defineCommand({
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Configures the verification role.')
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('Sets the role granted after verification.')
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Posts the verification panel.')
        .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('me').setDescription('Verifies yourself.')),
  description: 'Configures the verification role.',
  async execute(ctx) {
    const service = requireService(ctx.context.services.welcome, 'welcome');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'role') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const role = ctx.interaction.options.getRole('role', true);
      await service.update(ctx.guild.id, { verificationRoleId: role.id });
      await ctx.reply({ embeds: [successEmbed(`Verification role set to ${role}.`)], ephemeral: true });
      return;
    }

    if (sub === 'panel') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const channel = ctx.interaction.options.getChannel('channel', true);
      const config = await service.config(ctx.guild.id);
      await service.update(ctx.guild.id, { verificationChannelId: channel.id });
      if (channel.type === ChannelType.GuildText) {
        await (channel as TextChannel).send({
          content: `${config.verificationMessage} Use \`/verify me\` to unlock the server.`,
        });
      }
      await ctx.reply({ content: 'Verification panel posted.', ephemeral: true });
      return;
    }

    const message = await service.verify(ctx.guild, ctx.member);
    await ctx.reply({ content: message, ephemeral: true });
  },
});

export default [config, logs, welcome, verify];
