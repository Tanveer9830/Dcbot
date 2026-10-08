import { EmbedBuilder, SlashCommandBuilder, ChannelType } from 'discord.js';
import { defineCommand, getTargetMember, COLORS } from '../helpers.js';
import { formatBytes, formatDuration } from '../../utils/format.js';
import { isYoungAccount, snowflakeTimestamp } from '@dcbot/shared';

const botinfo = defineCommand({
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows bot status, uptime and system usage.'),
  description: 'Shows bot status, uptime and system usage.',
  requiresDatabase: false,
  cooldownMs: 10_000,
  async execute(ctx) {
    const memory = process.memoryUsage();
    const client = ctx.interaction.client;
    const embed = new EmbedBuilder()
      .setTitle(client.user?.username ?? 'Dcbot')
      .setThumbnail(client.user?.displayAvatarURL() ?? null)
      .setColor(COLORS.primary)
      .addFields(
        { name: 'Uptime', value: formatDuration(Date.now() - ctx.context.startedAt), inline: true },
        { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
        { name: 'Users', value: String(client.users.cache.size), inline: true },
        { name: 'Commands', value: String(ctx.context.registry?.size ?? 0), inline: true },
        { name: 'Gateway ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
        { name: 'Node', value: process.version, inline: true },
        { name: 'Heap', value: formatBytes(memory.heapUsed), inline: true },
        { name: 'RSS', value: formatBytes(memory.rss), inline: true },
        { name: 'Shard', value: `${(ctx.interaction.guild?.shardId ?? 0) + 1}/${client.options.shardCount ?? 1}`, inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
});

const serverinfo = defineCommand({
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Shows information about this server.'),
  description: 'Shows information about this server.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const guild = ctx.guild;
    const created = snowflakeTimestamp(guild.id);
    const channels = guild.channels.cache;
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL())
      .setColor(COLORS.primary)
      .addFields(
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Members', value: String(guild.memberCount), inline: true },
        { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
        {
          name: 'Channels',
          value: `${channels.filter((channel) => channel.type === ChannelType.GuildText).size} text, ${
            channels.filter((channel) => channel.type === ChannelType.GuildVoice).size
          } voice`,
          inline: true,
        },
        { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
        { name: 'Verification', value: String(guild.verificationLevel), inline: true },
        { name: 'Created', value: created ? created.toISOString().slice(0, 10) : 'unknown', inline: true },
        { name: 'ID', value: guild.id, inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
});

const userinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Shows information about a member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect')),
  description: 'Shows information about a member.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const target = getTargetMember(ctx.interaction, 'user') ?? ctx.member;
    const created = snowflakeTimestamp(target.id);
    const warnings = ctx.context.repos
      ? await ctx.context.repos.moderation.warningsFor(ctx.guild.id, target.id)
      : [];
    const embed = new EmbedBuilder()
      .setTitle(target.user.globalName ?? target.user.username)
      .setThumbnail(target.user.displayAvatarURL())
      .setColor(COLORS.primary)
      .addFields(
        { name: 'ID', value: target.id, inline: true },
        { name: 'Nickname', value: target.nickname ?? 'none', inline: true },
        { name: 'Joined', value: target.joinedAt?.toISOString().slice(0, 10) ?? 'unknown', inline: true },
        { name: 'Account created', value: created ? created.toISOString().slice(0, 10) : 'unknown', inline: true },
        { name: 'New account', value: isYoungAccount(target.id, 7 * 86_400_000) ? 'Yes (<7 days)' : 'No', inline: true },
        { name: 'Roles', value: String(target.roles.cache.size - 1), inline: true },
        { name: 'Warnings', value: String(warnings.length), inline: true },
        { name: 'Bot', value: target.user.bot ? 'Yes' : 'No', inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
});

const avatar = defineCommand({
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Shows a user\'s avatar.')
    .addUserOption((option) => option.setName('user').setDescription('User whose avatar to show')),
  description: "Shows a user's avatar.",
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s avatar`)
      .setImage(user.displayAvatarURL({ size: 1024 }))
      .setColor(COLORS.primary);
    await ctx.reply({ embeds: [embed] });
  },
});

const roleinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Shows information about a role.')
    .addRoleOption((option) => option.setName('role').setDescription('Role to inspect').setRequired(true)),
  description: 'Shows information about a role.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const selected = ctx.interaction.options.getRole('role');
    const role = selected ? ctx.guild.roles.cache.get(selected.id) : undefined;
    if (!role) {
      await ctx.reply({ content: 'That role is not available.', ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(role.name)
      .setColor(role.color || COLORS.primary)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Colour', value: role.hexColor, inline: true },
        { name: 'Position', value: String(role.position), inline: true },
        { name: 'Members', value: String(role.members.size), inline: true },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Managed', value: role.managed ? 'Yes' : 'No', inline: true },
        { name: 'Created', value: role.createdAt.toISOString().slice(0, 10), inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
});

const channelinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Shows information about a channel.')
    .addChannelOption((option) => option.setName('channel').setDescription('Channel to inspect')),
  description: 'Shows information about a channel.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const selectedChannel = ctx.interaction.options.getChannel('channel');
    const channel =
      (selectedChannel ? ctx.guild.channels.cache.get(selectedChannel.id) : undefined) ?? ctx.interaction.channel;
    if (!channel) {
      await ctx.reply({ content: 'That channel is not available.', ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`#${'name' in channel ? String(channel.name) : 'channel'}`)
      .setColor(COLORS.primary)
      .addFields(
        { name: 'ID', value: channel.id, inline: true },
        { name: 'Type', value: String(ChannelType[channel.type] ?? channel.type), inline: true },
        {
          name: 'Created',
          value:
            'createdTimestamp' in channel && channel.createdTimestamp
              ? new Date(channel.createdTimestamp).toISOString().slice(0, 10)
              : 'unknown',
          inline: true,
        },
      );
    if ('topic' in channel && channel.topic) embed.addFields({ name: 'Topic', value: channel.topic });
    if ('rateLimitPerUser' in channel) {
      embed.addFields({ name: 'Slowmode', value: `${channel.rateLimitPerUser}s`, inline: true });
    }
    await ctx.reply({ embeds: [embed] });
  },
});

const permissions = defineCommand({
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('Inspects the effective permissions of a member or the bot.')
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect'))
    .addChannelOption((option) => option.setName('channel').setDescription('Channel context')),
  description: 'Inspects the effective permissions of a member or the bot.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const member = getTargetMember(ctx.interaction, 'user') ?? ctx.member;
    const channel = ctx.interaction.options.getChannel('channel') ?? ctx.interaction.channel;
    const effective = channel && 'permissionsFor' in channel ? channel.permissionsFor(member) : member.permissions;
    const flags = effective.toArray();
    const embed = new EmbedBuilder()
      .setTitle(`Permissions for ${member.user.username}`)
      .setColor(COLORS.primary)
      .setDescription(
        flags.length > 0 ? flags.map((flag) => `✅ ${flag}`).join('\n').slice(0, 4000) : '_No permissions._',
      );
    await ctx.reply({ embeds: [embed] });
  },
});

export default [botinfo, serverinfo, userinfo, avatar, roleinfo, channelinfo, permissions];
