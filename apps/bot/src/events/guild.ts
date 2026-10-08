import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Message,
  type TextChannel,
} from 'discord.js';
import { detectDangerousPermissionChange } from '../security/thresholds.js';
import { evaluateNoTag } from '../security/noTag.js';
import { evaluateNoPin } from '../security/noPin.js';
import type { BotContext } from '../types.js';
import type { GuildMember, PartialGuildMember, PartialMessage } from 'discord.js';

/**
 * Guild-level event wiring: moderation signals, AutoMod, XP, /no-tag, /no-pin,
 * reaction roles and logging.
 *
 * Every handler is wrapped so one failing subsystem cannot take the bot down.
 */
export function registerGuildEvents(client: Client, ctx: BotContext): void {
  const logger = ctx.logger.child({ scope: 'guild-events' });
  const guard =
    <T extends unknown[]>(name: string, handler: (...args: T) => Promise<void> | void) =>
    async (...args: T): Promise<void> => {
      try {
        await handler(...args);
      } catch (error) {
        logger.warn(`${name} handler failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

  client.on(
    Events.GuildCreate,
    guard('guildCreate', async (guild: Guild) => {
      logger.info('joined guild', { guildId: guild.id, name: guild.name, members: guild.memberCount });
      await ctx.repos?.guilds.upsertGuild({
        guildId: guild.id,
        name: guild.name,
        ownerId: guild.ownerId,
        memberCount: guild.memberCount,
      });
    }),
  );

  client.on(
    Events.GuildDelete,
    guard('guildDelete', async (guild: Guild) => {
      logger.info('left guild', { guildId: guild.id });
      ctx.services.security?.reset(guild.id);
      await ctx.services.music?.stop(guild.id, { destroy: true });
    }),
  );

  client.on(
    Events.GuildMemberAdd,
    guard('guildMemberAdd', async (member) => {
      await ctx.repos?.guilds.upsertGuild({
        guildId: member.guild.id,
        name: member.guild.name,
        ownerId: member.guild.ownerId,
        memberCount: member.guild.memberCount,
      });
      const result = await ctx.services.welcome?.onMemberJoin(member);
      await ctx.services.security?.onMemberJoin(member.guild, member);

      // Suspicious (very young) accounts are logged, not auto-punned.
      const settings = ctx.repos ? await ctx.repos.security.getSettings(member.guild.id) : null;
      if (settings && settings.minAccountAgeDays > 0) {
        const ageMs = Date.now() - member.user.createdTimestamp;
        if (ageMs < settings.minAccountAgeDays * 86_400_000) {
          await ctx.services.security?.recordEvent({
            guildId: member.guild.id,
            type: 'suspicious_account',
            severity: 'medium',
            actorId: member.id,
            detail: { accountAgeHours: Math.round(ageMs / 3_600_000) },
          });
        }
      }
      await ctx.services.logging?.send(member.guild, 'members', () =>
        new EmbedBuilder()
          .setTitle('Member joined')
          .setDescription(`${member} (${member.id})`)
          .addFields({ name: 'Account created', value: member.user.createdAt.toISOString().slice(0, 10) })
          .setColor(0x57f287)
          .setTimestamp(),
      { event: 'member_join' });
      if (result?.rolesAdded.length) {
        logger.debug('auto-roles applied', { guildId: member.guild.id, count: result.rolesAdded.length });
      }
    }),
  );

  client.on(
    Events.GuildMemberRemove,
    guard('guildMemberRemove', async (member: GuildMember | PartialGuildMember) => {
      if (!member.partial && member.user) {
        await ctx.services.welcome?.onMemberLeave(member);
      }
      await ctx.services.logging?.send(member.guild, 'members', () =>
        new EmbedBuilder()
          .setTitle('Member left')
          .setDescription(`${member.user?.username ?? 'unknown'} (${member.id})`)
          .setColor(0xed4245)
          .setTimestamp(),
      { event: 'member_leave' });
    }),
  );

  client.on(
    Events.MessageCreate,
    guard('messageCreate', async (message: Message) => {
      if (!message.inGuild() || !message.guild) return;
      const guild = message.guild;
      const member = message.member;
      if (!member) return;

      const isStaff =
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.BanMembers);

      // 1. AutoMod
      if (ctx.services.automod) {
        const verdict = await ctx.services.automod.inspect({
          guildId: guild.id,
          content: message.content,
          mentionCount: message.mentions.users.size + message.mentions.roles.size,
          userId: message.author.id,
          roleIds: [...member.roles.cache.keys()],
          channelId: message.channelId,
          authorIsBot: message.author.bot,
          authorIsStaff: isStaff,
        });
        if (verdict.blocked) {
          await applyAutoModAction(message, verdict.rule ?? 'unknown', isStaff);
        }
      }

      // 2. /no-tag mention protection
      if (ctx.services.noTag && message.mentions.users.size > 0) {
        const settings = await ctx.repos?.guilds.getSettings(guild.id);
        const enabled = Boolean((settings?.no_tag as { enabled?: boolean } | undefined)?.enabled);
        const protectedUsers = await ctx.repos?.security.protectedUsers(guild.id);
        const decision = evaluateNoTag({
          enabled,
          protectedUsers: (protectedUsers ?? []).map((row) => ({
            userId: row.userId,
            mode: row.mode as 'log' | 'delete' | 'warn' | 'timeout',
            exemptRoleIds: row.exemptRoleIds,
            exemptUserIds: row.exemptUserIds,
          })),
          mentionedUserIds: [...message.mentions.users.keys()],
          offenderId: message.author.id,
          offenderRoleIds: [...member.roles.cache.keys()],
          offenderIsBot: message.author.bot,
          offenderIsStaff: isStaff,
        });
        if (decision.protected && !decision.exempt && decision.matchedUserId) {
          let actionTaken = 'logged';
          if (decision.mode === 'delete' && message.deletable) {
            await message.delete().then(() => (actionTaken = 'deleted')).catch(() => undefined);
          } else if (decision.mode === 'timeout' && member.moderatable) {
            await member
              .timeout(5 * 60_000, 'Mention protection: unwanted mention')
              .then(() => (actionTaken = 'timed out'))
              .catch(() => undefined);
          } else if (decision.mode === 'warn') {
            await ctx.services.moderation
              ?.warn({ guild, actor: guild.members.me!, target: member, reason: 'Mentioned a protected user' })
              .then(() => (actionTaken = 'warned'))
              .catch(() => undefined);
          }
          await ctx.repos?.security.recordNoTagViolation({
            guildId: guild.id,
            channelId: message.channelId,
            messageId: message.id,
            protectedUserId: decision.matchedUserId,
            offenderId: message.author.id,
            actionTaken,
          });
        }
      }

      // 3. XP
      const award = await ctx.services.leveling?.onMessage({
        guildId: guild.id,
        userId: message.author.id,
        channelId: message.channelId,
        contentLength: message.content.length,
      });
      if (award?.leveledUp && award.awarded > 0) {
        const settings = await ctx.repos?.guilds.getSettings(guild.id);
        const config = (settings?.leveling ?? {}) as { announceLevelUp?: boolean; announceChannelId?: string | null };
        if (config.announceLevelUp !== false) {
          const announced =
            (config.announceChannelId ? guild.channels.cache.get(config.announceChannelId) : undefined) ??
            message.channel;
          if (announced && announced.type === ChannelType.GuildText) {
            await (announced as TextChannel)
              .send({
                content: `🎉 ${message.author} reached **level ${award.profile.level}**!`,
                flags: MessageFlags.SuppressNotifications,
              })
              .catch(() => undefined);
          }
        }
        for (const roleId of award.newRoles) {
          await member.roles.add(roleId, 'Level reward').catch(() => undefined);
        }
      }

      // 4. Anti-spam
      await ctx.services.security?.onMessage({
        guild,
        member,
        channelId: message.channelId,
        messageId: message.id,
      });

      // 5. Branding (off by default, rate limited, never for bots)
      const branded = await ctx.services.branding?.shouldRespond({
        guildId: guild.id,
        channelId: message.channelId,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
      });
      if (branded) {
        await message.reply({ content: branded }).catch(() => undefined);
      }

      // 6. Ticket transcript capture
      await ctx.services.tickets?.recordMessage({
        guildId: guild.id,
        channelId: message.channelId,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        content: message.content,
        attachmentCount: message.attachments.size,
      });
    }),
  );

  client.on(
    Events.MessageDelete,
    guard('messageDelete', async (message: Message | PartialMessage) => {
      if (!message.guild || !message.inGuild()) return;
      await ctx.services.logging?.send(
        message.guild,
        'messages',
        () =>
          new EmbedBuilder()
            .setTitle('Message deleted')
            .setDescription(
              // Only describe what the bot actually saw. Nothing is invented.
              message.content
                ? message.content.slice(0, 1000)
                : '_Content was not in cache; it cannot be recovered._',
            )
            .addFields(
              { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
              {
                name: 'Author',
                value: message.author ? `${message.author} (${message.author.id})` : 'unknown (not cached)',
                inline: true,
              },
            )
            .setColor(0xed4245)
            .setTimestamp(),
      { event: 'message_delete' });
    }),
  );

  client.on(
    Events.MessageUpdate,
    guard('messageUpdate', async (before: Message | PartialMessage, after: Message | PartialMessage) => {
      if (!after.guild || !after.inGuild() || before.content === after.content) return;
      await ctx.services.logging?.send(
        after.guild,
        'messages',
        () =>
          new EmbedBuilder()
            .setTitle('Message edited')
            .setDescription(after.url ? `[Jump](${after.url})` : '_jump link unavailable_')
            .addFields(
              { name: 'Before', value: (before.content || '_empty_').slice(0, 1000) },
              { name: 'After', value: (after.content || '_empty_').slice(0, 1000) },
            )
            .setColor(0xfaa61a)
            .setTimestamp(),
      { event: 'message_edit' });
    }),
  );

  client.on(
    Events.MessageReactionAdd,
    guard('messageReactionAdd', async (reaction, user) => {
      if (user.bot || !reaction.message.guild) return;
      const guild = reaction.message.guild;
      const emoji = reaction.emoji.id ?? reaction.emoji.name ?? '';
      if (!emoji) return;

      const binding = await ctx.repos?.community.reactionRoleFor(guild.id, reaction.message.id, emoji);
      if (!binding) return;
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      // Role hierarchy guard: never assign a role above the bot's own.
      const role = guild.roles.cache.get(binding.roleId);
      if (!role) return;
      const botHighest = guild.members.me?.roles.highest.position ?? 0;
      if (role.position >= botHighest) return;

      if (binding.mode === 'bind' || binding.mode === 'toggle') {
        await member.roles.add(role, 'Reaction role').catch(() => undefined);
      }
    }),
  );

  client.on(
    Events.MessageReactionRemove,
    guard('messageReactionRemove', async (reaction, user) => {
      if (user.bot || !reaction.message.guild) return;
      const guild = reaction.message.guild;
      const emoji = reaction.emoji.id ?? reaction.emoji.name ?? '';
      const binding = await ctx.repos?.community.reactionRoleFor(guild.id, reaction.message.id, emoji);
      if (!binding || binding.mode === 'bind') return;
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;
      await member.roles.remove(binding.roleId, 'Reaction role removed').catch(() => undefined);
    }),
  );

  // --- /no-pin ---------------------------------------------------------------

  client.on(
    Events.ChannelPinsUpdate,
    guard('channelPinsUpdate', async (channel) => {
      if (!('guild' in channel) || !channel.guild) return;
      const guild = channel.guild;
      const settings = await ctx.repos?.guilds.getSettings(guild.id);
      const config = (settings?.no_pin ?? {}) as {
        enabled?: boolean;
        mode?: 'log' | 'alert' | 'unpin';
        exemptUserIds?: string[];
        exemptRoleIds?: string[];
      };

      // Discord gives us no pin event payload, so attribute via the audit log.
      let actorId: string | null = null;
      let actorSource: 'audit_log' | 'unknown' = 'unknown';
      let pinned = true;
      let messageId: string | null = null;
      try {
        const entries = await guild.fetchAuditLogs({ type: AuditLogEvent.MessagePin, limit: 1 });
        const entry = entries.entries.first();
        if (entry) {
          actorId = entry.executorId;
          actorSource = 'audit_log';
          const target = entry.target as { id?: string; pinned?: boolean } | null;
          messageId = target?.id ?? null;
          pinned = target?.pinned !== false;
        }
      } catch {
        // Missing View Audit Log permission is normal; degrade gracefully.
      }

      let actorRoles: string[] = [];
      let actorIsStaff = false;
      if (actorId) {
        const actor = await guild.members.fetch(actorId).catch(() => null);
        if (actor) {
          actorRoles = [...actor.roles.cache.keys()];
          actorIsStaff = actor.permissions.has(PermissionFlagsBits.ManageGuild);
        }
      }

      const decision = evaluateNoPin({
        enabled: Boolean(config.enabled),
        mode: config.mode ?? 'log',
        pinned,
        actorId,
        exemptUserIds: config.exemptUserIds ?? [],
        exemptRoleIds: config.exemptRoleIds ?? [],
        actorRoleIds: actorRoles,
        actorIsStaff,
      });
      if (!decision.record) return;

      let actionTaken = 'none';
      if (!decision.exempt && decision.mode === 'unpin' && messageId && channel.type === ChannelType.GuildText) {
        const fetched = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
        if (fetched?.pinnable) {
          await fetched.unpin('no-pin protection').then(() => (actionTaken = 'unpinned')).catch(() => undefined);
        }
      }

      await ctx.services.noPin?.log({
        guildId: guild.id,
        channelId: channel.id,
        pinned,
        actorId,
        actorSource,
        messageId,
        actionTaken,
        detail: { mode: decision.mode, exempt: decision.exempt, reason: decision.reason },
      });

      if (decision.mode === 'alert' || actionTaken !== 'none') {
        const settings2 = await ctx.repos?.security.getSettings(guild.id);
        await ctx.services.security?.alert(guild, settings2?.alertChannelId ?? null, {
          title: pinned ? 'Message pinned' : 'Message unpinned',
          severity: 'medium',
          description: `${actorId ? `<@${actorId}>` : 'Unknown actor'} in <#${channel.id}> → ${actionTaken}`,
        });
      }
    }),
  );

  // --- anti-nuke: audit-log driven ------------------------------------------

  client.on(
    Events.GuildAuditLogEntryCreate,
    guard('guildAuditLogEntryCreate', async (entry, guild) => {
      const dangerous = new Set<number>([
        AuditLogEvent.MemberBanAdd,
        AuditLogEvent.MemberKick,
        AuditLogEvent.RoleDelete,
        AuditLogEvent.ChannelDelete,
        AuditLogEvent.WebhookCreate,
        AuditLogEvent.WebhookDelete,
        AuditLogEvent.RoleUpdate,
      ]);
      if (!dangerous.has(entry.action)) return;

      const actorId = entry.executorId;
      const trusted = actorId ? await ctx.services.security?.isTrusted(guild.id, actorId, []) : false;
      if (trusted) return;

      let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
      let type: 'role_deleted' | 'channel_deleted' | 'webhook_update' | 'mass_ban' | 'mass_kick' | 'dangerous_permission_change' =
        'dangerous_permission_change';

      if (entry.action === AuditLogEvent.MemberBanAdd) {
        type = 'mass_ban';
        severity = 'high';
      } else if (entry.action === AuditLogEvent.MemberKick) {
        type = 'mass_kick';
        severity = 'high';
      } else if (entry.action === AuditLogEvent.RoleDelete) {
        type = 'role_deleted';
        severity = 'high';
      } else if (entry.action === AuditLogEvent.ChannelDelete) {
        type = 'channel_deleted';
        severity = 'high';
      } else if (entry.action === AuditLogEvent.WebhookCreate || entry.action === AuditLogEvent.WebhookDelete) {
        type = 'webhook_update';
        severity = 'high';
      } else if (entry.action === AuditLogEvent.RoleUpdate) {
        const changes = entry.changes ?? [];
        const permissionChange = changes.find((change) => change.key === 'permissions');
        if (permissionChange) {
          const before = BigInt(String(permissionChange.old ?? '0'));
          const after = BigInt(String(permissionChange.new ?? '0'));
          const dangerousChange = detectDangerousPermissionChange(before, after);
          if (!dangerousChange.triggered) return;
          severity = 'critical';
        }
      }

      await ctx.services.security?.recordEvent({
        guildId: guild.id,
        type,
        severity,
        actorId: actorId ?? null,
        detail: { action: String(entry.action), targetId: entry.targetId ?? null },
      });

      const settings = await ctx.repos?.security.getSettings(guild.id);
      await ctx.services.security?.alert(guild, settings?.alertChannelId ?? null, {
        title: `Anti-nuke: ${type.replace(/_/g, ' ')}`,
        severity,
        description: actorId ? `Actor: <@${actorId}>` : 'Actor unknown (audit log unavailable)',
      });
    }),
  );

  client.on(
    Events.GuildBanAdd,
    guard('guildBanAdd', async (ban) => {
      await ctx.repos?.moderation.createCase({
        guildId: ban.guild.id,
        type: 'ban',
        targetId: ban.user.id,
        actorId: 'unknown',
        reason: ban.reason ?? 'No reason available',
      });
    }),
  );

  client.on(
    Events.GuildRoleDelete,
    guard('roleDelete', async (role) => {
      await ctx.services.security?.recordEvent({
        guildId: role.guild.id,
        type: 'role_deleted',
        severity: 'high',
        detail: { roleId: role.id, roleName: role.name },
      });
    }),
  );

  client.on(
    Events.ChannelDelete,
    guard('channelDelete', async (channel) => {
      if (!('guild' in channel) || !channel.guild) return;
      await ctx.services.security?.recordEvent({
        guildId: channel.guild.id,
        type: 'channel_deleted',
        severity: 'high',
        detail: { channelId: channel.id, channelName: 'name' in channel ? String(channel.name) : 'unknown' },
      });
    }),
  );

  client.on(
    Events.WebhooksUpdate,
    guard('webhooksUpdate', async (channel) => {
      if (!channel.guild) return;
      await ctx.services.security?.recordEvent({
        guildId: channel.guild.id,
        type: 'webhook_update',
        severity: 'medium',
        channelId: channel.id,
      });
    }),
  );

  client.on(
    Events.GuildMemberUpdate,
    guard('guildMemberUpdate', async (before, after) => {
      if (!after.guild) return;
      const added = after.roles.cache.filter((role) => !before.roles.cache.has(role.id));
      const removed = before.roles.cache.filter((role) => !after.roles.cache.has(role.id));
      if (added.size === 0 && removed.size === 0) return;
      await ctx.services.logging?.send(
        after.guild,
        'members',
        () =>
          new EmbedBuilder()
            .setTitle('Roles changed')
            .setDescription(`${after}`)
            .addFields(
              { name: 'Added', value: [...added.values()].join(', ') || 'none' },
              { name: 'Removed', value: [...removed.values()].join(', ') || 'none' },
            )
            .setColor(0xfaa61a)
            .setTimestamp(),
      { event: 'role_change' });
    }),
  );
}

/** Applies the configured AutoMod response. */
async function applyAutoModAction(message: Message, rule: string, _isStaff: boolean): Promise<void> {
  const ctxRepos = (message.client as Client & { ctx?: BotContext }).ctx;
  const settings = ctxRepos?.repos ? await ctxRepos.repos.guilds.getSettings(message.guild!.id) : null;
  const config = (settings?.automod ?? {}) as { action?: 'log' | 'delete' | 'warn' | 'timeout' };
  const action = config.action ?? 'log';

  if (action === 'delete' && message.deletable) {
    await message.delete().catch(() => undefined);
  } else if (action === 'timeout' && message.member?.moderatable) {
    await message.member.timeout(5 * 60_000, `AutoMod: ${rule}`).catch(() => undefined);
  } else if (action === 'warn' && message.member && message.guild) {
    await ctxRepos?.services.moderation
      ?.warn({
        guild: message.guild,
        actor: message.guild.members.me!,
        target: message.member,
        reason: `AutoMod rule triggered: ${rule}`,
      })
      .catch(() => undefined);
  }

  await ctxRepos?.services.logging?.send(
    message.guild!,
    'messages',
    () =>
      new EmbedBuilder()
        .setTitle(`AutoMod: ${rule}`)
        .setDescription(`${message.author} in <#${message.channelId}>`)
        .addFields({ name: 'Action', value: action })
        .setColor(0xfaa61a)
        .setTimestamp(),
  );
}
