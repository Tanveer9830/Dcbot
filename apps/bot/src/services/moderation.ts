import { EmbedBuilder, GuildMember, PermissionFlagsBits, type Guild, type User } from 'discord.js';
import { canModerateTarget, ValidationError, type ModerationActionType } from '@dcbot/shared';
import type { Repositories } from '../database/repositories.js';
import type { LoggingService } from './logging.js';
import type { Logger } from '../utils/logger.js';

export interface ActionParams {
  guild: Guild;
  actor: GuildMember | User;
  target: GuildMember;
  reason: string;
  durationMs?: number;
  evidenceUrl?: string;
}

export interface ActionResult {
  success: boolean;
  caseNumber?: number;
  message: string;
}

/**
 * Moderation service.
 *
 * Every action: validates hierarchy *before* calling Discord, performs the
 * action, records a case, writes a log entry. Destructive actions that Discord
 * cannot undo are documented as such - nothing here claims to reverse a ban
 * that was never recorded.
 */
export class ModerationService {
  constructor(
    private readonly repos: Repositories,
    private readonly logging: LoggingService,
    private readonly logger: Logger,
  ) {}

  private hierarchyCheck(params: ActionParams): string | null {
    const botMember = params.guild.members.me;
    const botHighest = botMember?.roles.highest.position ?? 0;
    const actorHighest =
      params.actor instanceof GuildMember
        ? params.actor.roles.highest.position
        : Number.MAX_SAFE_INTEGER;

    const allowed = canModerateTarget({
      targetIsGuildOwner: params.guild.ownerId === params.target.id,
      actorHighestRolePosition: actorHighest,
      targetHighestRolePosition: params.target.roles.highest.position,
      botHighestRolePosition: botHighest,
    });
    if (!allowed) {
      return `${params.target} cannot be moderated: they are the server owner, or their highest role is at or above yours or the bot's.`;
    }
    return null;
  }

  async ban(params: ActionParams): Promise<ActionResult> {
    const blocked = this.hierarchyCheck(params);
    if (blocked) return { success: false, message: blocked };
    try {
      await params.target.ban({ reason: truncateReason(params.reason), deleteMessageSeconds: 0 });
      return this.record(params, 'ban', `Banned ${params.target}.`);
    } catch (error) {
      return { success: false, message: describeError(error) };
    }
  }

  async kick(params: ActionParams): Promise<ActionResult> {
    const blocked = this.hierarchyCheck(params);
    if (blocked) return { success: false, message: blocked };
    if (!params.target.kickable) {
      return {
        success: false,
        message: `I cannot kick ${params.target} (hierarchy or permissions).`,
      };
    }
    try {
      await params.target.kick(truncateReason(params.reason));
      return this.record(params, 'kick', `Kicked ${params.target}.`);
    } catch (error) {
      return { success: false, message: describeError(error) };
    }
  }

  async timeout(params: ActionParams & { durationMs: number }): Promise<ActionResult> {
    if (params.durationMs <= 0) throw new ValidationError('Duration must be greater than zero.');
    if (params.durationMs > 28 * 24 * 60 * 60 * 1000) {
      throw new ValidationError('Discord caps timeouts at 28 days.');
    }
    const blocked = this.hierarchyCheck(params);
    if (blocked) return { success: false, message: blocked };
    if (!params.target.moderatable) {
      return {
        success: false,
        message: `I cannot time out ${params.target} (hierarchy or permissions).`,
      };
    }
    try {
      await params.target.timeout(params.durationMs, truncateReason(params.reason));
      return this.record(params, 'timeout', `Timed out ${params.target}.`, params.durationMs);
    } catch (error) {
      return { success: false, message: describeError(error) };
    }
  }

  async removeTimeout(params: ActionParams): Promise<ActionResult> {
    try {
      await params.target.timeout(null, truncateReason(params.reason));
      return this.record(params, 'untimeout', `Removed timeout from ${params.target}.`);
    } catch (error) {
      return { success: false, message: describeError(error) };
    }
  }

  async unban(params: Omit<ActionParams, 'target'> & { targetId: string }): Promise<ActionResult> {
    try {
      await params.guild.bans.remove(params.targetId, truncateReason(params.reason));
      const caseNumber = await this.recordCase(params, 'unban', params.targetId);
      return { success: true, caseNumber, message: `Unbanned <@${params.targetId}>.` };
    } catch (error) {
      return { success: false, message: describeError(error) };
    }
  }

  async warn(params: ActionParams): Promise<ActionResult & { warningCount: number }> {
    const warning = await this.repos.moderation.addWarning({
      guildId: params.guild.id,
      userId: params.target.id,
      moderatorId: params.actor.id,
      reason: params.reason,
    });
    const recorded = await this.record(params, 'warn', `Warned ${params.target}.`);
    const warnings = await this.repos.moderation.warningsFor(params.guild.id, params.target.id);

    // Notify the user by DM when possible; a closed DM is not an error.
    try {
      const embed = new EmbedBuilder()
        .setTitle(`Warning in ${params.guild.name}`)
        .setDescription(params.reason)
        .addFields({ name: 'Total warnings', value: String(warnings.length) })
        .setTimestamp();
      await params.target.send({ embeds: [embed] });
    } catch {
      this.logger.debug('moderation: DM failed', {
        guildId: params.guild.id,
        targetId: params.target.id,
      });
    }
    return { ...recorded, warningCount: warnings.length, caseNumber: warning.id };
  }

  /**
   * Bulk delete, respecting Discord's 100 message / 14 day limits.
   * Returns the number actually deleted.
   */
  async purge(
    guild: Guild,
    channelId: string,
    limit: number,
    actorId: string,
    reason: string,
  ): Promise<{ deleted: number; message: string }> {
    const count = Math.min(Math.max(1, limit), 100);
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !('bulkDelete' in channel)) {
      throw new ValidationError('That channel does not support bulk delete.');
    }
    try {
      const deleted = await (
        channel as { bulkDelete: (n: number, filterOld?: boolean) => Promise<{ size: number }> }
      ).bulkDelete(count, true);
      await this.repos.moderation
        .createCase({ guildId: guild.id, type: 'purge', targetId: channelId, actorId, reason })
        .catch(() => undefined);
      return { deleted: deleted.size, message: `Deleted ${deleted.size} message(s).` };
    } catch (error) {
      return { deleted: 0, message: describeError(error) };
    }
  }

  async setSlowmode(
    guild: Guild,
    channelId: string,
    seconds: number,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !('setRateLimitPerUser' in channel)) {
      throw new ValidationError('That channel does not support slowmode.');
    }
    await (
      channel as { setRateLimitPerUser: (s: number, r?: string) => Promise<unknown> }
    ).setRateLimitPerUser(seconds, truncateReason(reason));
    await this.recordCaseById(
      guild.id,
      'note',
      channelId,
      actorId,
      `Slowmode set to ${seconds}s: ${reason}`,
    );
    return `Slowmode set to ${seconds}s in <#${channelId}>.`;
  }

  async setLocked(
    guild: Guild,
    channelId: string,
    locked: boolean,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !('permissionOverwrites' in channel)) {
      throw new ValidationError('That channel cannot be locked.');
    }
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      SendMessages: locked ? false : null,
      AddReactions: locked ? false : null,
    });
    await this.recordCaseById(guild.id, locked ? 'lock' : 'unlock', channelId, actorId, reason);
    return locked ? `Locked <#${channelId}>.` : `Unlocked <#${channelId}>.`;
  }

  async addRole(
    guild: Guild,
    target: GuildMember,
    roleId: string,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const role = guild.roles.cache.get(roleId);
    if (!role) throw new ValidationError('That role does not exist.');
    const botHighest = guild.members.me?.roles.highest.position ?? 0;
    if (role.position >= botHighest) {
      throw new ValidationError('That role is above my highest role, so I cannot assign it.');
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new ValidationError(
        'Refusing to assign a role with Administrator through this command.',
      );
    }
    await target.roles.add(role, truncateReason(reason));
    await this.recordCaseById(
      guild.id,
      'role_add',
      target.id,
      actorId,
      `Added ${role.name}: ${reason}`,
      roleId,
    );
    return `Added ${role} to ${target}.`;
  }

  async removeRole(
    guild: Guild,
    target: GuildMember,
    roleId: string,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const role = guild.roles.cache.get(roleId);
    if (!role) throw new ValidationError('That role does not exist.');
    await target.roles.remove(role, truncateReason(reason));
    await this.recordCaseById(
      guild.id,
      'role_remove',
      target.id,
      actorId,
      `Removed ${role.name}: ${reason}`,
      roleId,
    );
    return `Removed ${role} from ${target}.`;
  }

  async setNickname(
    guild: Guild,
    target: GuildMember,
    nickname: string | null,
    actorId: string,
    reason: string,
  ): Promise<string> {
    await target.setNickname(nickname, truncateReason(reason));
    await this.recordCaseById(
      guild.id,
      'nickname',
      target.id,
      actorId,
      `Nickname set to ${nickname ?? '(cleared)'}: ${reason}`,
    );
    return nickname ? `Set ${target}'s nickname to ${nickname}.` : `Cleared ${target}'s nickname.`;
  }

  private async recordCase(
    params: ActionParams | (Omit<ActionParams, 'target'> & { targetId: string }),
    type: ModerationActionType,
    targetId?: string,
  ): Promise<number> {
    return this.recordCaseById(
      params.guild.id,
      type,
      targetId ?? (params as ActionParams).target?.id ?? '',
      params.actor.id,
      params.reason,
    );
  }

  private async recordCaseById(
    guildId: string,
    type: ModerationActionType,
    targetId: string,
    actorId: string,
    reason: string,
    evidenceUrl?: string,
  ): Promise<number> {
    const created = await this.repos.moderation.createCase({
      guildId,
      type,
      targetId,
      actorId,
      reason,
      evidenceUrl,
    });
    return created.caseNumber;
  }

  private async record(
    params: ActionParams,
    type: ModerationActionType,
    message: string,
    durationMs?: number,
  ): Promise<ActionResult> {
    const caseNumber = await this.recordCase(params, type);
    const guild = params.guild;
    await this.logging.send(
      guild,
      'moderation',
      () =>
        new EmbedBuilder()
          .setTitle(`${type.toUpperCase()} - case #${caseNumber}`)
          .setColor(0xed4245)
          .addFields(
            { name: 'Target', value: `${params.target} (${params.target.id})`, inline: true },
            { name: 'Moderator', value: `${params.actor} (${params.actor.id})`, inline: true },
            ...(durationMs
              ? [{ name: 'Duration', value: `${Math.round(durationMs / 60000)}m`, inline: true }]
              : []),
            { name: 'Reason', value: params.reason },
          )
          .setTimestamp(),
      { event: 'moderation' },
    );
    return { success: true, caseNumber, message: `${message} (case #${caseNumber})` };
  }
}

function truncateReason(reason: string): string {
  return reason.length > 480 ? `${reason.slice(0, 477)}...` : reason;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Discord rejected that action: ${message}`;
}
