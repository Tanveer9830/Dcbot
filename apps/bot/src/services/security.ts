import { ChannelType, EmbedBuilder, type Guild, type GuildMember, type TextChannel } from 'discord.js';
import type { SecurityRepository } from '@dcbot/database';
import type { SecurityEventType, SecuritySeverity } from '@dcbot/shared';
import type { LockdownManager } from '../security/lockdown.js';
import { SlidingWindowTracker } from '../security/trackers.js';
import { detectRaid, detectSpam, type Thresholds } from '../security/thresholds.js';
import type { Logger, ThrottledLogger } from '../utils/logger.js';

/**
 * Server security service.
 *
 * Coordinates the detectors, records events, alerts, and triggers automated
 * responses. It never claims to prevent something Discord has already allowed;
 * the actions it takes are the ones a bot can actually perform (kick, timeout,
 * lockdown, alert).
 */
export class SecurityService {
  private readonly joins = new SlidingWindowTracker({ windowMs: 10_000, maxKeys: 20_000 });
  private readonly messages = new SlidingWindowTracker({ windowMs: 5_000, maxKeys: 50_000 });

  constructor(
    private readonly security: SecurityRepository,
    private readonly lockdown: LockdownManager,
    private readonly logger: Logger,
    private readonly throttled: ThrottledLogger,
  ) {}

  async settings(guildId: string) {
    return this.security.getSettings(guildId);
  }

  /** Called by the guildMemberAdd event. */
  async onMemberJoin(guild: Guild, member: GuildMember): Promise<{ action: string | null }> {
    const settings = await this.security.getSettings(guild.id);
    if (!settings.antiRaidEnabled) return { action: null };

    const thresholds: Thresholds = {
      joinThreshold: settings.joinThreshold,
      joinWindowMs: settings.joinWindowMs,
      spamThreshold: settings.spamThreshold,
      spamWindowMs: settings.spamWindowMs,
      mentionThreshold: settings.mentionThreshold,
      minAccountAgeDays: settings.minAccountAgeDays,
    };
    this.joins.push(`join:${guild.id}`);
    const recent = this.joins.count(`join:${guild.id}`);
    const detection = detectRaid(
      Array.from({ length: recent }, () => Date.now()),
      thresholds,
    );
    if (!detection.triggered) return { action: null };

    await this.recordEvent({
      guildId: guild.id,
      type: 'anti_raid',
      severity: detection.severity,
      actorId: member.id,
      detail: { joins: detection.value, windowMs: thresholds.joinWindowMs },
      actionTaken: settings.lockdownOnTrigger ? 'lockdown' : 'alert',
    });
    await this.alert(guild, settings.alertChannelId, {
      title: 'Anti-raid triggered',
      severity: detection.severity,
      description: detection.reason,
    });
    if (settings.lockdownOnTrigger && !this.lockdown.isLocked(guild.id)) {
      const result = await this.lockdown.lock(guild, { reason: 'anti-raid' });
      this.logger.warn('security: lockdown engaged', { guildId: guild.id, locked: result.locked.length });
    }
    return { action: settings.lockdownOnTrigger ? 'lockdown' : 'alert' };
  }

  /** Called by the messageCreate event. Returns the action taken, if any. */
  async onMessage(params: {
    guild: Guild;
    member: GuildMember;
    channelId: string;
    messageId: string;
  }): Promise<{ action: string | null; severity: SecuritySeverity | null }> {
    const settings = await this.security.getSettings(params.guild.id);
    if (!settings.antiSpamEnabled) return { action: null, severity: null };

    this.messages.push(`${params.guild.id}:${params.member.id}`);
    const count = this.messages.count(`${params.guild.id}:${params.member.id}`);
    const detection = detectSpam(Array.from({ length: count }, () => Date.now()), {
      joinThreshold: settings.joinThreshold,
      joinWindowMs: settings.joinWindowMs,
      spamThreshold: settings.spamThreshold,
      spamWindowMs: settings.spamWindowMs,
      mentionThreshold: settings.mentionThreshold,
      minAccountAgeDays: settings.minAccountAgeDays,
    });
    if (!detection.triggered) return { action: null, severity: null };

    // De-escalate: warn first, then timeout, so a single burst is not a ban.
    let action = 'alert';
    try {
      if (params.member.moderatable && count >= settings.spamThreshold * 2) {
        await params.member.timeout(5 * 60_000, 'Anti-spam: message flood');
        action = 'timeout';
      }
    } catch (error) {
      this.throttled.warn('security', 'anti-spam timeout failed', {
        guildId: params.guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await this.recordEvent({
      guildId: params.guild.id,
      type: 'anti_spam',
      severity: detection.severity,
      actorId: params.member.id,
      channelId: params.channelId,
      detail: { messages: detection.value, windowMs: settings.spamWindowMs },
      actionTaken: action,
    });
    await this.alert(params.guild, settings.alertChannelId, {
      title: 'Anti-spam triggered',
      severity: detection.severity,
      description: `${params.member} - ${detection.reason}`,
    });
    return { action, severity: detection.severity };
  }

  /** Generic security event recorder used by the audit-log and channel events. */
  async recordEvent(params: {
    guildId: string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    actorId?: string | null;
    channelId?: string | null;
    detail?: Record<string, unknown>;
    actionTaken?: string | null;
  }): Promise<number> {
    return this.security.recordEvent(params);
  }

  /** Writes to the configured alert channel. Missing channel = debug log only. */
  async alert(
    guild: Guild,
    channelId: string | null,
    payload: { title: string; severity: SecuritySeverity; description: string; fields?: Array<{ name: string; value: string }> },
  ): Promise<boolean> {
    const color =
      payload.severity === 'critical' ? 0x990000 : payload.severity === 'high' ? 0xed4245 : payload.severity === 'medium' ? 0xfaa61a : 0x57f287;
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ ${payload.title}`)
      .setDescription(payload.description)
      .setColor(color)
      .addFields({ name: 'Severity', value: payload.severity.toUpperCase(), inline: true }, ...(payload.fields ?? []))
      .setTimestamp();

    if (!channelId) {
      this.logger.warn(`security: ${payload.title} (no alert channel configured)`, { guildId: guild.id });
      return false;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    try {
      await (channel as TextChannel).send({ embeds: [embed] });
      return true;
    } catch (error) {
      this.throttled.warn('security', 'alert delivery failed', {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async isTrusted(guildId: string, userId: string, roleIds: readonly string[]): Promise<boolean> {
    return this.security.isTrusted(guildId, userId, roleIds);
  }

  getLockdown(): LockdownManager {
    return this.lockdown;
  }

  /** Drops tracking state for a guild (used when the bot leaves). */
  reset(guildId: string): void {
    this.joins.clear(`join:${guildId}`);
  }
}
