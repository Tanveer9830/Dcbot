import { SlashCommandBuilder } from 'discord.js';
import { defineCommand, getTargetMember, requireService, successEmbed, errorEmbed, ValidationError } from '../helpers.js';
import { formatDuration, parseDuration } from '../../utils/format.js';
import { PERMISSION_BIT } from '@dcbot/shared';


const ban = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log').setRequired(true)),
  description: 'Bans a member.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.BAN_MEMBERS],
  clientPermissions: [PERMISSION_BIT.BAN_MEMBERS],
  cooldownMs: 3000,
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const result = await moderation.ban({
      guild: ctx.guild,
      actor: ctx.member,
      target,
      reason: ctx.interaction.options.getString('reason', true),
    });
    await ctx.reply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
});

const unban = defineCommand({
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Revokes a ban by user ID.')
    .addStringOption((option) => option.setName('user_id').setDescription('User ID to unban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log').setRequired(true)),
  description: 'Revokes a ban by user ID.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.BAN_MEMBERS],
  clientPermissions: [PERMISSION_BIT.BAN_MEMBERS],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const result = await moderation.unban({
      guild: ctx.guild,
      actor: ctx.member,
      targetId: ctx.interaction.options.getString('user_id', true),
      reason: ctx.interaction.options.getString('reason', true),
    });
    await ctx.reply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
});

const kick = defineCommand({
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kicks a member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log').setRequired(true)),
  description: 'Kicks a member.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.KICK_MEMBERS],
  clientPermissions: [PERMISSION_BIT.KICK_MEMBERS],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const result = await moderation.kick({
      guild: ctx.guild,
      actor: ctx.member,
      target,
      reason: ctx.interaction.options.getString('reason', true),
    });
    await ctx.reply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
});

const timeout = defineCommand({
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Times a member out, or removes their timeout.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Times a member out.')
        .addUserOption((option) => option.setName('user').setDescription('Member to time out').setRequired(true))
        .addStringOption((option) => option.setName('duration').setDescription('e.g. 10m, 2h, 1d').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a timeout.')
        .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log')),
    ),
  description: 'Times a member out, or removes their timeout.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MODERATE_MEMBERS],
  clientPermissions: [PERMISSION_BIT.MODERATE_MEMBERS],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const sub = ctx.interaction.options.getSubcommand();
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const reason = ctx.interaction.options.getString('reason') ?? 'No reason provided';

    if (sub === 'add') {
      const ms = parseDuration(ctx.interaction.options.getString('duration', true));
      if (ms === null) throw new ValidationError('Could not read that duration. Try `10m`, `2h` or `1d`.');
      if (ms > 28 * 24 * 60 * 60 * 1000) throw new ValidationError('Discord caps timeouts at 28 days.');
      const result = await moderation.timeout({
        guild: ctx.guild,
        actor: ctx.member,
        target,
        reason,
        durationMs: ms,
      });
      await ctx.reply({
        embeds: [
          result.success
            ? successEmbed(`${result.message} (${formatDuration(ms)})`)
            : errorEmbed(result.message),
        ],
      });
      return;
    }
    const result = await moderation.removeTimeout({ guild: ctx.guild, actor: ctx.member, target, reason });
    await ctx.reply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
});

const warn = defineCommand({
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Records a formal warning against a member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason recorded in the mod log').setRequired(true)),
  description: 'Records a formal warning against a member.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MODERATE_MEMBERS],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const result = await moderation.warn({
      guild: ctx.guild,
      actor: ctx.member,
      target,
      reason: ctx.interaction.options.getString('reason', true),
    });
    await ctx.reply({
      embeds: [successEmbed(`${result.message} They now have ${result.warningCount} warning(s).`)],
    });
  },
});

const warnings = defineCommand({
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Lists warnings for a member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to look up').setRequired(true)),
  description: 'Lists warnings for a member.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MODERATE_MEMBERS],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const target = ctx.interaction.options.getUser('user', true);
    const rows = await repos.moderation.warningsFor(ctx.guild.id, target.id);
    const lines =
      rows.length === 0
        ? ['_No warnings recorded._']
        : rows.map((row) => `\`${row.id}\` ${row.createdAt.toISOString().slice(0, 10)} by <@${row.moderatorId}> - ${row.reason}`);
    await ctx.reply({
      embeds: [
        {
          title: `Warnings for ${target.username} (${rows.length})`,
          description: lines.join('\n').slice(0, 4000),
          color: 0xfaa61a,
        },
      ],
    });
  },
});

const purge = defineCommand({
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk deletes recent messages in this channel (Discord limit: 100, last 14 days).')
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('How many messages (1-100)').setMinValue(1).setMaxValue(100).setRequired(true),
    )
    .addUserOption((option) => option.setName('user').setDescription('Only delete messages from this member')),
  description: 'Bulk deletes recent messages in this channel.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_MESSAGES],
  clientPermissions: [PERMISSION_BIT.MANAGE_MESSAGES],
  cooldownMs: 10_000,
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const amount = ctx.interaction.options.getInteger('amount', true);
    const user = ctx.interaction.options.getUser('user');

    if (user && ctx.interaction.channel?.isTextBased()) {
      // User-filtered purge uses fetch + individual deletes (bulkDelete cannot filter).
      const fetched = await ctx.interaction.channel.messages.fetch({ limit: Math.min(100, amount * 2) });
      const matching = fetched.filter((message) => message.author.id === user.id).first(amount);
      let deleted = 0;
      for (const message of matching) {
        await message.delete().then(() => (deleted += 1)).catch(() => undefined);
      }
      await ctx.reply({ content: `Deleted ${deleted} message(s) from ${user}.`, ephemeral: true });
      return;
    }

    const result = await moderation.purge(ctx.guild, ctx.interaction.channelId, amount, ctx.interaction.user.id, 'purge command');
    await ctx.reply({ content: result.message, ephemeral: true });
  },
});

const slowmode = defineCommand({
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Sets the slowmode delay for a channel.')
    .addIntegerOption((option) =>
      option.setName('seconds').setDescription('Delay in seconds (0 disables)').setMinValue(0).setMaxValue(21600).setRequired(true),
    )
    .addChannelOption((option) => option.setName('channel').setDescription('Channel (defaults to this one)')),
  description: 'Sets the slowmode delay for a channel.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_CHANNELS],
  clientPermissions: [PERMISSION_BIT.MANAGE_CHANNELS],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const channel = ctx.interaction.options.getChannel('channel') ?? ctx.interaction.channel;
    const message = await moderation.setSlowmode(
      ctx.guild,
      channel!.id,
      ctx.interaction.options.getInteger('seconds', true),
      ctx.interaction.user.id,
      'slowmode command',
    );
    await ctx.reply({ content: message, ephemeral: true });
  },
});

const lock = defineCommand({
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Locks or unlocks a channel for @everyone.')
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Locks or unlocks a single channel.')
        .addStringOption((option) =>
          option.setName('state').setDescription('Lock or unlock').addChoices({ name: 'lock', value: 'lock' }, { name: 'unlock', value: 'unlock' }).setRequired(true),
        )
        .addChannelOption((option) => option.setName('channel').setDescription('Channel (defaults to this one)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('server')
        .setDescription('Emergency: locks every text channel for @everyone.'),
    )
    .addSubcommand((sub) => sub.setName('release').setDescription('Releases an emergency server lockdown.')),
  description: 'Locks or unlocks channels.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_CHANNELS],
  clientPermissions: [PERMISSION_BIT.MANAGE_CHANNELS],
  async execute(ctx) {
    const security = requireService(ctx.context.services.security, 'security');
    const sub = ctx.interaction.options.getSubcommand();
    const lockdown = security.getLockdown();

    if (sub === 'server') {
      const result = await lockdown.lock(ctx.guild, { reason: 'manual lockdown' });
      await ctx.reply({
        embeds: [successEmbed(`Locked ${result.locked.length} channel(s). ${result.failed.length} failed.`)],
      });
      return;
    }
    if (sub === 'release') {
      const result = await lockdown.unlock(ctx.guild);
      await ctx.reply({ embeds: [successEmbed(`Released ${result.locked.length} channel(s).`)] });
      return;
    }

    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const state = ctx.interaction.options.getString('state', true) === 'lock';
    const channel = ctx.interaction.options.getChannel('channel') ?? ctx.interaction.channel;
    const message = await moderation.setLocked(ctx.guild, channel!.id, state, ctx.interaction.user.id, 'lock command');
    await ctx.reply({ content: message, ephemeral: true });
  },
});

const nickname = defineCommand({
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Changes or clears a member\'s nickname.')
    .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('nickname').setDescription('New nickname (leave empty to clear)')),
  description: "Changes or clears a member's nickname.",
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  clientPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  async execute(ctx) {
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const message = await moderation.setNickname(
      ctx.guild,
      target,
      ctx.interaction.options.getString('nickname'),
      ctx.interaction.user.id,
      'nickname command',
    );
    await ctx.reply({ content: message, ephemeral: true });
  },
});

const role = defineCommand({
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Adds or removes a role from a member.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Adds a role.')
        .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a role.')
        .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists this server\'s roles and member counts.')),
  description: 'Manages member roles.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  clientPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  async execute(ctx) {
    const sub = ctx.interaction.options.getSubcommand();
    if (sub === 'list') {
      const roles = ctx.guild.roles.cache
        .filter((entry) => entry.id !== ctx.guild.roles.everyone.id)
        .sort((a, b) => b.position - a.position)
        .first(25)
        .map((entry) => `${entry} - ${entry.members.size} member(s)`);
      await ctx.reply({
        embeds: [{ title: 'Roles', description: roles.join('\n').slice(0, 4000) || '_No roles._', color: 0x5865f2 }],
      });
      return;
    }
    const moderation = requireService(ctx.context.services.moderation, 'moderation');
    const target = getTargetMember(ctx.interaction, 'user');
    if (!target) throw new ValidationError('That member is not in this server.');
    const selected = ctx.interaction.options.getRole('role', true);
    const message =
      sub === 'add'
        ? await moderation.addRole(ctx.guild, target, selected.id, ctx.interaction.user.id, 'role add command')
        : await moderation.removeRole(ctx.guild, target, selected.id, ctx.interaction.user.id, 'role remove command');
    await ctx.reply({ content: message, ephemeral: true });
  },
});

const cases = defineCommand({
  data: new SlashCommandBuilder()
    .setName('cases')
    .setDescription('Shows moderation history.')
    .addSubcommand((sub) =>
      sub.setName('user').setDescription('History for a member.').addUserOption((option) =>
        option.setName('user').setDescription('Member').setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName('moderator').setDescription('Actions taken by a moderator.').addUserOption((option) =>
        option.setName('user').setDescription('Moderator').setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Marks a case as revoked.')
        .addIntegerOption((option) => option.setName('case').setDescription('Case number').setRequired(true)),
    ),
  description: 'Shows and manages moderation history.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MODERATE_MEMBERS],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'revoke') {
      const caseNumber = ctx.interaction.options.getInteger('case', true);
      const ok = await repos.moderation.revokeCase(ctx.guild.id, caseNumber);
      await ctx.reply({
        embeds: [ok ? successEmbed(`Case #${caseNumber} marked revoked.`) : errorEmbed('No such case, or it is already revoked.')],
      });
      return;
    }

    const target = ctx.interaction.options.getUser('user', true);
    const rows =
      sub === 'user'
        ? await repos.moderation.listCasesForUser(ctx.guild.id, target.id)
        : await repos.moderation.listCasesByActor(ctx.guild.id, target.id);
    const lines =
      rows.length === 0
        ? ['_No cases recorded._']
        : rows.map(
            (row) =>
              `#${row.caseNumber} **${row.type}** ${row.createdAt.toISOString().slice(0, 10)} - ${row.reason}${row.revoked ? ' _(revoked)_' : ''}`,
          );
    await ctx.reply({
      embeds: [{ title: `Cases (${rows.length})`, description: lines.join('\n').slice(0, 4000), color: 0x5865f2 }],
    });
  },
});

export default [ban, unban, kick, timeout, warn, warnings, purge, slowmode, lock, nickname, role, cases];
