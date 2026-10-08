import { SlashCommandBuilder } from 'discord.js';
import { defineCommand, getTargetMember, requireService, successEmbed, errorEmbed, ValidationError } from '../helpers.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const security = defineCommand({
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Server security configuration and monitoring.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the current security configuration and recent events.'))
    .addSubcommand((sub) =>
      sub
        .setName('trust')
        .setDescription('Marks a user or role as trusted (exempt from automated responses).')
        .addUserOption((option) => option.setName('user').setDescription('User to trust'))
        .addRoleOption((option) => option.setName('role').setDescription('Role to trust'))
        .addStringOption((option) => option.setName('reason').setDescription('Why')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('untrust')
        .setDescription('Removes a trust entry.')
        .addUserOption((option) => option.setName('user').setDescription('User'))
        .addRoleOption((option) => option.setName('role').setDescription('Role')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('thresholds')
        .setDescription('Sets anti-raid and anti-spam thresholds.')
        .addIntegerOption((option) => option.setName('joins').setDescription('Joins allowed in the window').setMinValue(1).setMaxValue(100))
        .addIntegerOption((option) => option.setName('join_window_s').setDescription('Window in seconds').setMinValue(1).setMaxValue(300))
        .addIntegerOption((option) => option.setName('messages').setDescription('Messages allowed in the window').setMinValue(2).setMaxValue(50))
        .addIntegerOption((option) => option.setName('message_window_s').setDescription('Window in seconds').setMinValue(1).setMaxValue(120)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Enables or disables a protection module.')
        .addStringOption((option) =>
          option.setName('module').setDescription('Module').addChoices(
            { name: 'anti-nuke', value: 'antiNuke' },
            { name: 'anti-raid', value: 'antiRaid' },
            { name: 'anti-spam', value: 'antiSpam' },
            { name: 'auto-lockdown', value: 'lockdown' },
          ).setRequired(true),
        )
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('events').setDescription('Shows the most recent security events.'))
    .addSubcommand((sub) =>
      sub.setName('alerts').setDescription('Sets the channel used for security alerts.').addChannelOption((option) =>
        option.setName('channel').setDescription('Channel (leave empty to clear)'),
      ),
    ),
  description: 'Server security configuration and monitoring.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const service = requireService(ctx.context.services.security, 'security');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'status') {
      const settings = await repos.security.getSettings(ctx.guild.id);
      const events = await repos.security.recentEvents(ctx.guild.id, 5);
      await ctx.reply({
        embeds: [
          {
            title: 'Security status',
            color: 0x5865f2,
            fields: [
              { name: 'Anti-nuke', value: settings.antiNukeEnabled ? 'on' : 'off', inline: true },
              { name: 'Anti-raid', value: settings.antiRaidEnabled ? 'on' : 'off', inline: true },
              { name: 'Anti-spam', value: settings.antiSpamEnabled ? 'on' : 'off', inline: true },
              { name: 'Auto-lockdown', value: settings.lockdownOnTrigger ? 'on' : 'off', inline: true },
              { name: 'Join threshold', value: `${settings.joinThreshold} / ${settings.joinWindowMs / 1000}s`, inline: true },
              { name: 'Spam threshold', value: `${settings.spamThreshold} / ${settings.spamWindowMs / 1000}s`, inline: true },
              {
                name: 'Recent events',
                value: events.length
                  ? events.map((event) => `\`${event.type}\` (${event.severity})`).join('\n')
                  : '_none recorded_',
              },
            ],
          },
        ],
      });
      return;
    }

    if (sub === 'trust') {
      const user = ctx.interaction.options.getUser('user');
      const role = ctx.interaction.options.getRole('role');
      const reason = ctx.interaction.options.getString('reason') ?? undefined;
      if (!user && !role) throw new ValidationError('Provide a user or a role.');
      if (user) await repos.security.addTrustedUser(ctx.guild.id, user.id, ctx.interaction.user.id, reason);
      if (role) await repos.security.addTrustedRole(ctx.guild.id, role.id, ctx.interaction.user.id, reason);
      await repos.audit.record({
        guildId: ctx.guild.id,
        actorId: ctx.interaction.user.id,
        action: 'security.trust',
        targetType: user ? 'user' : 'role',
        targetId: user?.id ?? role?.id ?? '',
        detail: { reason: reason ?? null },
      });
      await ctx.reply({ embeds: [successEmbed('Trust entry added.')] });
      return;
    }

    if (sub === 'untrust') {
      const user = ctx.interaction.options.getUser('user');
      const role = ctx.interaction.options.getRole('role');
      const removed = user
        ? await repos.security.removeTrustedUser(ctx.guild.id, user.id)
        : role
          ? await repos.security.removeTrustedRole(ctx.guild.id, role.id)
          : false;
      await ctx.reply({ embeds: [removed ? successEmbed('Trust entry removed.') : errorEmbed('No matching trust entry.')] });
      return;
    }

    if (sub === 'thresholds') {
      const patch = {
        ...(ctx.interaction.options.getInteger('joins') !== null ? { joinThreshold: ctx.interaction.options.getInteger('joins')! } : {}),
        ...(ctx.interaction.options.getInteger('join_window_s') !== null
          ? { joinWindowMs: ctx.interaction.options.getInteger('join_window_s')! * 1000 }
          : {}),
        ...(ctx.interaction.options.getInteger('messages') !== null
          ? { spamThreshold: ctx.interaction.options.getInteger('messages')! }
          : {}),
        ...(ctx.interaction.options.getInteger('message_window_s') !== null
          ? { spamWindowMs: ctx.interaction.options.getInteger('message_window_s')! * 1000 }
          : {}),
      };
      if (Object.keys(patch).length === 0) throw new ValidationError('Provide at least one threshold.');
      const updated = await repos.security.updateSettings(ctx.guild.id, { ...patch, updatedBy: ctx.interaction.user.id });
      await ctx.reply({
        embeds: [
          successEmbed(
            `Thresholds updated: joins ${updated.joinThreshold}/${updated.joinWindowMs / 1000}s, messages ${updated.spamThreshold}/${updated.spamWindowMs / 1000}s.`,
          ),
        ],
      });
      return;
    }

    if (sub === 'toggle') {
      const module = ctx.interaction.options.getString('module', true);
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      const patch =
        module === 'antiNuke'
          ? { antiNukeEnabled: enabled }
          : module === 'antiRaid'
            ? { antiRaidEnabled: enabled }
            : module === 'antiSpam'
              ? { antiSpamEnabled: enabled }
              : { lockdownOnTrigger: enabled };
      await repos.security.updateSettings(ctx.guild.id, { ...patch, updatedBy: ctx.interaction.user.id });
      await ctx.reply({ embeds: [successEmbed(`${module} is now ${enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    if (sub === 'events') {
      const events = await repos.security.recentEvents(ctx.guild.id, 20);
      await ctx.reply({
        embeds: [
          {
            title: `Security events (${events.length})`,
            color: 0xed4245,
            description:
              events
                .map((event) =>
                  `\`${event.createdAt.toISOString().slice(0, 16)}\` **${event.type}** (${event.severity})${event.actorId ? ` by <@${event.actorId}>` : ''}${event.actionTaken ? ` → ${event.actionTaken}` : ''}`,
                )
                .join('\n')
                .slice(0, 4000) || '_no events recorded_',
          },
        ],
      });
      return;
    }

    if (sub === 'alerts') {
      const channel = ctx.interaction.options.getChannel('channel');
      await repos.security.updateSettings(ctx.guild.id, {
        alertChannelId: channel?.id ?? null,
        updatedBy: ctx.interaction.user.id,
      });
      await ctx.reply({ embeds: [successEmbed(channel ? `Alerts will go to <#${channel.id}>.` : 'Alert channel cleared.')] });
    }
  },
});

const automod = defineCommand({
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configures automatic message filtering.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the current AutoMod configuration.'))
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enables or disables AutoMod.')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rule')
        .setDescription('Toggles an individual filter.')
        .addStringOption((option) =>
          option.setName('rule').setDescription('Filter').addChoices(
            { name: 'invite links', value: 'blockInvites' },
            { name: 'suspicious links', value: 'blockLinks' },
            { name: 'mass mentions', value: 'blockMentions' },
            { name: 'excessive caps', value: 'blockCaps' },
            { name: 'repeated messages', value: 'blockRepeated' },
          ).setRequired(true),
        )
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('blockedword')
        .setDescription('Adds or removes a blocked word.')
        .addStringOption((option) => option.setName('word').setDescription('Word or phrase').setRequired(true))
        .addBooleanOption((option) => option.setName('remove').setDescription('Remove instead of add')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('exempt')
        .setDescription('Exempts a role or channel from filtering.')
        .addRoleOption((option) => option.setName('role').setDescription('Role to exempt'))
        .addChannelOption((option) => option.setName('channel').setDescription('Channel to exempt'))
        .addBooleanOption((option) => option.setName('remove').setDescription('Remove the exemption')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('action')
        .setDescription('Sets what happens when a rule triggers.')
        .addStringOption((option) =>
          option.setName('action').setDescription('Action').addChoices(
            { name: 'log only', value: 'log' },
            { name: 'delete message', value: 'delete' },
            { name: 'warn author', value: 'warn' },
            { name: 'timeout author', value: 'timeout' },
          ).setRequired(true),
        ),
    ),
  description: 'Configures automatic message filtering.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const service = requireService(ctx.context.services.automod, 'automod');
    const sub = ctx.interaction.options.getSubcommand();
    const config = await service.config(ctx.guild.id);

    if (sub === 'status') {
      await ctx.reply({
        embeds: [
          {
            title: 'AutoMod',
            color: 0x5865f2,
            fields: [
              { name: 'Enabled', value: config.enabled ? 'yes' : 'no', inline: true },
              { name: 'Action', value: config.action, inline: true },
              { name: 'Invites', value: String(config.blockInvites), inline: true },
              { name: 'Suspicious links', value: String(config.blockLinks), inline: true },
              { name: 'Mass mentions', value: `${config.blockMentions} (>=${config.mentionThreshold})`, inline: true },
              { name: 'Caps', value: `${config.blockCaps} (>${Math.round(config.capsRatio * 100)}%)`, inline: true },
              { name: 'Repeated', value: String(config.blockRepeated), inline: true },
              { name: 'Blocked words', value: String(config.blockedWords.length), inline: true },
              { name: 'Exempt roles', value: String(config.exemptRoleIds.length), inline: true },
              { name: 'Exempt channels', value: String(config.exemptChannelIds.length), inline: true },
            ],
          },
        ],
      });
      return;
    }

    if (sub === 'enable') {
      const updated = await service.update(ctx.guild.id, { enabled: ctx.interaction.options.getBoolean('enabled', true) });
      await ctx.reply({ embeds: [successEmbed(`AutoMod ${updated.enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    if (sub === 'rule') {
      const rule = ctx.interaction.options.getString('rule', true) as keyof typeof config;
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      const updated = await service.update(ctx.guild.id, { [rule]: enabled } as never);
      await ctx.reply({ embeds: [successEmbed(`${String(rule)} is now ${enabled ? 'on' : 'off'}.`)] });
      return;
    }

    if (sub === 'blockedword') {
      const word = ctx.interaction.options.getString('word', true).toLowerCase().trim();
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      const words = remove ? config.blockedWords.filter((entry) => entry !== word) : [...new Set([...config.blockedWords, word])];
      const updated = await service.update(ctx.guild.id, { blockedWords: words });
      await ctx.reply({
        embeds: [successEmbed(`${remove ? 'Removed' : 'Added'} \`${word}\`. ${updated.blockedWords.length} blocked word(s).`)],
      });
      return;
    }

    if (sub === 'exempt') {
      const role = ctx.interaction.options.getRole('role');
      const channel = ctx.interaction.options.getChannel('channel');
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      if (!role && !channel) throw new ValidationError('Provide a role or a channel.');
      const patch: Record<string, string[]> = {};
      if (role) {
        patch.exemptRoleIds = remove
          ? config.exemptRoleIds.filter((id) => id !== role.id)
          : [...new Set([...config.exemptRoleIds, role.id])];
      }
      if (channel) {
        patch.exemptChannelIds = remove
          ? config.exemptChannelIds.filter((id) => id !== channel.id)
          : [...new Set([...config.exemptChannelIds, channel.id])];
      }
      await service.update(ctx.guild.id, patch as never);
      await ctx.reply({ embeds: [successEmbed('Exemption updated.')] });
      return;
    }

    if (sub === 'action') {
      const action = ctx.interaction.options.getString('action', true) as typeof config.action;
      await service.update(ctx.guild.id, { action });
      await ctx.reply({ embeds: [successEmbed(`AutoMod action set to \`${action}\`.`)] });
    }
  },
});

const notag = defineCommand({
  data: new SlashCommandBuilder()
    .setName('notag')
    .setDescription('Protect users from unwanted mentions.')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Enables mention protection for this server.')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('protect')
        .setDescription('Protects yourself, or another user if you are staff.')
        .addUserOption((option) => option.setName('user').setDescription('User (defaults to you)'))
        .addStringOption((option) =>
          option.setName('mode').setDescription('What to do').addChoices(
            { name: 'log', value: 'log' },
            { name: 'delete message', value: 'delete' },
            { name: 'warn author', value: 'warn' },
            { name: 'timeout author', value: 'timeout' },
          ),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('unprotect').setDescription('Removes protection.').addUserOption((option) =>
        option.setName('user').setDescription('User (defaults to you)'),
      ),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows your protection state.'))
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists all protected users (staff only).'))
    .addSubcommand((sub) =>
      sub
        .setName('exempt')
        .setDescription('Adds an exemption for a user or role (staff only).')
        .addUserOption((option) => option.setName('protected').setDescription('Protected user').setRequired(true))
        .addUserOption((option) => option.setName('user').setDescription('Exempt user'))
        .addRoleOption((option) => option.setName('role').setDescription('Exempt role'))
        .addBooleanOption((option) => option.setName('remove').setDescription('Remove the exemption')),
    )
    .addSubcommand((sub) => sub.setName('logs').setDescription('Shows recent violations (staff only).')),
  description: 'Protect users from unwanted mentions.',
  async execute(ctx) {
    const service = requireService(ctx.context.services.noTag, 'no-tag');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const actorId = ctx.interaction.user.id;
    const staff =
      ctx.member.permissions.has('ManageGuild') || ctx.member.permissions.has('BanMembers');
    const owner = ctx.context.owners.isOwner(actorId);

    if (sub === 'setup') {
      if (!staff && !owner) {
        await ctx.reply({ content: 'Only server staff can enable mention protection.', ephemeral: true });
        return;
      }
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      await repos.guilds.updateSettingsGroup(ctx.guild.id, 'no_tag', { enabled });
      await ctx.reply({ embeds: [successEmbed(`Mention protection ${enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    if (sub === 'protect') {
      const target = getTargetMember(ctx.interaction, 'user');
      const targetId = target?.id ?? actorId;
      service.assertCanManage({ actorId, targetUserId: targetId, actorIsStaff: staff, actorIsOwner: owner });
      const mode = (ctx.interaction.options.getString('mode') ?? 'delete') as 'log' | 'delete' | 'warn' | 'timeout';
      await service.protect({ guildId: ctx.guild.id, userId: targetId, mode, setBy: actorId, selfSelected: targetId === actorId });
      await ctx.reply({ embeds: [successEmbed(`<@${targetId}> is now protected (mode: ${mode}).`)] });
      return;
    }

    if (sub === 'unprotect') {
      const target = getTargetMember(ctx.interaction, 'user');
      const targetId = target?.id ?? actorId;
      service.assertCanManage({ actorId, targetUserId: targetId, actorIsStaff: staff, actorIsOwner: owner });
      const removed = await repos.security.unprotectUser(ctx.guild.id, targetId);
      await ctx.reply({ embeds: [removed ? successEmbed('Protection removed.') : errorEmbed('That user was not protected.')] });
      return;
    }

    if (sub === 'status') {
      const state = await repos.security.isProtected(ctx.guild.id, actorId);
      await ctx.reply({
        content: state.protected
          ? `You are protected. Mode: \`${state.mode}\`. Exempt roles: ${state.exemptRoleIds.length}, exempt users: ${state.exemptUserIds.length}.`
          : 'You are not protected. Use `/notag protect` to enable it.',
        ephemeral: true,
      });
      return;
    }

    if (sub === 'list') {
      if (!staff && !owner) {
        await ctx.reply({ content: 'Staff only.', ephemeral: true });
        return;
      }
      const rows = await service.listProtected(ctx.guild.id);
      await ctx.reply({
        embeds: [
          {
            title: `Protected users (${rows.length})`,
            color: 0x5865f2,
            description: rows.map((row) => `<@${row.userId}> - \`${row.mode}\`${row.selfSelected ? ' (self)' : ''}`).join('\n').slice(0, 4000) || '_none_',
          },
        ],
      });
      return;
    }

    if (sub === 'exempt') {
      if (!staff && !owner) {
        await ctx.reply({ content: 'Staff only.', ephemeral: true });
        return;
      }
      const protectedUser = ctx.interaction.options.getUser('protected', true);
      const existing = await repos.security.isProtected(ctx.guild.id, protectedUser.id);
      if (!existing.protected) throw new ValidationError('That user is not protected.');
      const user = ctx.interaction.options.getUser('user');
      const role = ctx.interaction.options.getRole('role');
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      const roleIds = role
        ? remove
          ? existing.exemptRoleIds.filter((id) => id !== role.id)
          : [...new Set([...existing.exemptRoleIds, role.id])]
        : existing.exemptRoleIds;
      const userIds = user
        ? remove
          ? existing.exemptUserIds.filter((id) => id !== user.id)
          : [...new Set([...existing.exemptUserIds, user.id])]
        : existing.exemptUserIds;
      await repos.security.setNoTagExemptions(ctx.guild.id, protectedUser.id, roleIds, userIds);
      await ctx.reply({ embeds: [successEmbed('Exemptions updated.')] });
      return;
    }

    if (sub === 'logs') {
      if (!staff && !owner) {
        await ctx.reply({ content: 'Staff only.', ephemeral: true });
        return;
      }
      const rows = await service.violations(ctx.guild.id, 20);
      await ctx.reply({
        embeds: [
          {
            title: `Mention violations (${rows.length})`,
            color: 0xfaa61a,
            description:
              rows
                .map((row) => `\`${row.createdAt.toISOString().slice(0, 16)}\` <@${row.offenderId}> mentioned <@${row.protectedUserId}> → ${row.actionTaken}`)
                .join('\n')
                .slice(0, 4000) || '_none recorded_',
          },
        ],
      });
    }
  },
});

const nopin = defineCommand({
  data: new SlashCommandBuilder()
    .setName('nopin')
    .setDescription('Monitors pin and unpin activity.')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Enables pin monitoring.')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true))
        .addStringOption((option) =>
          option.setName('mode').setDescription('Response').addChoices(
            { name: 'log only', value: 'log' },
            { name: 'log + alert', value: 'alert' },
            { name: 'unpin it', value: 'unpin' },
          ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('exempt')
        .setDescription('Exempts a user or role.')
        .addUserOption((option) => option.setName('user').setDescription('User'))
        .addRoleOption((option) => option.setName('role').setDescription('Role'))
        .addBooleanOption((option) => option.setName('remove').setDescription('Remove the exemption')),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the current configuration.'))
    .addSubcommand((sub) => sub.setName('logs').setDescription('Shows recent pin activity.')),
  description: 'Monitors pin and unpin activity.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const settings = await repos.guilds.getSettings(ctx.guild.id);
    const current = (settings.no_pin ?? {}) as {
      enabled?: boolean;
      mode?: string;
      exemptUserIds?: string[];
      exemptRoleIds?: string[];
      alertChannelId?: string | null;
    };

    if (sub === 'setup') {
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      const mode = ctx.interaction.options.getString('mode') ?? current.mode ?? 'log';
      await repos.guilds.updateSettingsGroup(ctx.guild.id, 'no_pin', { enabled, mode });
      await ctx.reply({
        embeds: [
          successEmbed(
            `Pin monitoring ${enabled ? 'enabled' : 'disabled'} (mode: ${mode}). Note: Discord has no pre-pin hook, so pins are detected and can be reversed, not prevented.`,
          ),
        ],
      });
      return;
    }

    if (sub === 'exempt') {
      const user = ctx.interaction.options.getUser('user');
      const role = ctx.interaction.options.getRole('role');
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      if (!user && !role) throw new ValidationError('Provide a user or a role.');
      const userIds = user
        ? remove
          ? (current.exemptUserIds ?? []).filter((id) => id !== user.id)
          : [...new Set([...(current.exemptUserIds ?? []), user.id])]
        : (current.exemptUserIds ?? []);
      const roleIds = role
        ? remove
          ? (current.exemptRoleIds ?? []).filter((id) => id !== role.id)
          : [...new Set([...(current.exemptRoleIds ?? []), role.id])]
        : (current.exemptRoleIds ?? []);
      await repos.guilds.updateSettingsGroup(ctx.guild.id, 'no_pin', { exemptUserIds: userIds, exemptRoleIds: roleIds });
      await ctx.reply({ embeds: [successEmbed('Exemptions updated.')] });
      return;
    }

    if (sub === 'status') {
      await ctx.reply({
        embeds: [
          {
            title: 'Pin monitoring',
            color: 0x5865f2,
            fields: [
              { name: 'Enabled', value: String(current.enabled ?? false), inline: true },
              { name: 'Mode', value: current.mode ?? 'log', inline: true },
              { name: 'Exempt users', value: String((current.exemptUserIds ?? []).length), inline: true },
              { name: 'Exempt roles', value: String((current.exemptRoleIds ?? []).length), inline: true },
            ],
          },
        ],
      });
      return;
    }

    if (sub === 'logs') {
      const service = requireService(ctx.context.services.noPin, 'no-pin');
      const rows = await service.history(ctx.guild.id, 20);
      await ctx.reply({
        embeds: [
          {
            title: `Pin events (${rows.length})`,
            color: 0xfaa61a,
            description:
              rows
                .map(
                  (row) =>
                    `\`${row.createdAt.toISOString().slice(0, 16)}\` ${row.pinned ? '📌 pin' : '📍 unpin'} in <#${row.channelId}> by ${
                      row.actorId ? `<@${row.actorId}> (${row.actorSource})` : 'unknown actor'
                    } → ${row.actionTaken}`,
                )
                .join('\n')
                .slice(0, 4000) || '_none recorded_',
          },
        ],
      });
    }
  },
});

export default [security, automod, notag, nopin];
