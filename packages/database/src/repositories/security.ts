import type { Queryable } from '../client.js';
import type { SecurityEvent, SecurityEventType, SecuritySeverity } from '@dcbot/shared';

export interface SecuritySettings {
  guildId: string;
  antiNukeEnabled: boolean;
  antiRaidEnabled: boolean;
  antiSpamEnabled: boolean;
  joinThreshold: number;
  joinWindowMs: number;
  spamThreshold: number;
  spamWindowMs: number;
  mentionThreshold: number;
  minAccountAgeDays: number;
  lockdownOnTrigger: boolean;
  alertChannelId: string | null;
  configHistory: Array<Record<string, unknown>>;
  updatedBy: string | null;
  updatedAt: Date;
}

export const SECURITY_DEFAULTS: Omit<
  SecuritySettings,
  'guildId' | 'configHistory' | 'updatedBy' | 'updatedAt'
> = {
  antiNukeEnabled: true,
  antiRaidEnabled: true,
  antiSpamEnabled: true,
  joinThreshold: 5,
  joinWindowMs: 10_000,
  spamThreshold: 5,
  spamWindowMs: 5_000,
  mentionThreshold: 10,
  minAccountAgeDays: 0,
  lockdownOnTrigger: false,
  alertChannelId: null,
};

export class SecurityRepository {
  constructor(private readonly db: Queryable) {}

  async getSettings(guildId: string): Promise<SecuritySettings> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM security_settings WHERE guild_id = $1',
      [guildId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        ...SECURITY_DEFAULTS,
        guildId,
        configHistory: [],
        updatedBy: null,
        updatedAt: new Date(),
      };
    }
    return mapSettings(row);
  }

  async updateSettings(
    guildId: string,
    patch: Partial<Omit<SecuritySettings, 'guildId' | 'configHistory' | 'updatedAt'>>,
  ): Promise<SecuritySettings> {
    // The row has a FK to guilds; make sure the guild row exists first.
    await this.db.query(
      'INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
      [guildId],
    );

    const current = await this.getSettings(guildId);
    const next = { ...current, ...patch };
    // The change is appended to the on-row history so configuration changes
    // stay auditable without a separate table per field.
    const historyEntry = JSON.stringify({ at: new Date().toISOString(), patch });

    await this.db.query(
      `INSERT INTO security_settings (
         guild_id, anti_nuke_enabled, anti_raid_enabled, anti_spam_enabled,
         join_threshold, join_window_ms, spam_threshold, spam_window_ms,
         mention_threshold, min_account_age_days, lockdown_on_trigger,
         alert_channel_id, updated_by, config_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       ON CONFLICT (guild_id) DO UPDATE SET
         anti_nuke_enabled    = EXCLUDED.anti_nuke_enabled,
         anti_raid_enabled    = EXCLUDED.anti_raid_enabled,
         anti_spam_enabled    = EXCLUDED.anti_spam_enabled,
         join_threshold       = EXCLUDED.join_threshold,
         join_window_ms       = EXCLUDED.join_window_ms,
         spam_threshold       = EXCLUDED.spam_threshold,
         spam_window_ms       = EXCLUDED.spam_window_ms,
         mention_threshold    = EXCLUDED.mention_threshold,
         min_account_age_days = EXCLUDED.min_account_age_days,
         lockdown_on_trigger  = EXCLUDED.lockdown_on_trigger,
         alert_channel_id     = EXCLUDED.alert_channel_id,
         updated_by           = EXCLUDED.updated_by,
         config_history       = security_settings.config_history || EXCLUDED.config_history,
         updated_at           = now()`,
      [
        guildId,
        next.antiNukeEnabled,
        next.antiRaidEnabled,
        next.antiSpamEnabled,
        next.joinThreshold,
        next.joinWindowMs,
        next.spamThreshold,
        next.spamWindowMs,
        next.mentionThreshold,
        next.minAccountAgeDays,
        next.lockdownOnTrigger,
        next.alertChannelId,
        next.updatedBy,
        historyEntry,
      ],
    );
    return this.getSettings(guildId);
  }

  async addTrustedUser(
    guildId: string,
    userId: string,
    grantedBy: string,
    reason?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO security_trusted_users (guild_id, user_id, granted_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason`,
      [guildId, userId, grantedBy, reason ?? null],
    );
  }

  async removeTrustedUser(guildId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM security_trusted_users WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addTrustedRole(
    guildId: string,
    roleId: string,
    grantedBy: string,
    reason?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO security_trusted_roles (guild_id, role_id, granted_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, role_id) DO UPDATE SET granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason`,
      [guildId, roleId, grantedBy, reason ?? null],
    );
  }

  async removeTrustedRole(guildId: string, roleId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM security_trusted_roles WHERE guild_id = $1 AND role_id = $2',
      [guildId, roleId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async trustedUserIds(guildId: string): Promise<string[]> {
    const result = await this.db.query<{ user_id: string }>(
      'SELECT user_id FROM security_trusted_users WHERE guild_id = $1',
      [guildId],
    );
    return result.rows.map((row) => row.user_id);
  }

  async trustedRoleIds(guildId: string): Promise<string[]> {
    const result = await this.db.query<{ role_id: string }>(
      'SELECT role_id FROM security_trusted_roles WHERE guild_id = $1',
      [guildId],
    );
    return result.rows.map((row) => row.role_id);
  }

  async isTrusted(guildId: string, userId: string, roleIds: readonly string[]): Promise<boolean> {
    const result = await this.db.query<{ trusted: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM security_trusted_users WHERE guild_id = $1 AND user_id = $2
         UNION ALL
         SELECT 1 FROM security_trusted_roles WHERE guild_id = $1 AND role_id = ANY($3::text[])
       ) AS trusted`,
      [guildId, userId, [...roleIds]],
    );
    return Boolean(result.rows[0]?.trusted);
  }

  async recordEvent(params: {
    guildId: string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    actorId?: string | null;
    channelId?: string | null;
    detail?: Record<string, unknown>;
    actionTaken?: string | null;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO security_events (guild_id, type, severity, actor_id, channel_id, detail, action_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        params.guildId,
        params.type,
        params.severity,
        params.actorId ?? null,
        params.channelId ?? null,
        JSON.stringify(params.detail ?? {}),
        params.actionTaken ?? null,
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async recentEvents(
    guildId: string,
    limit = 25,
    type?: SecurityEventType,
  ): Promise<SecurityEvent[]> {
    const result = await this.db.query<Record<string, unknown>>(
      type
        ? `SELECT * FROM security_events WHERE guild_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT $3`
        : `SELECT * FROM security_events WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`,
      type ? [guildId, type, limit] : [guildId, limit],
    );
    return result.rows.map(mapEvent);
  }

  /** Counts events of a type in a window; used by escalation logic. */
  async countEventsSince(guildId: string, type: SecurityEventType, since: Date): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM security_events WHERE guild_id = $1 AND type = $2 AND created_at >= $3',
      [guildId, type, since],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  // --- /no-tag ---------------------------------------------------------------

  /**
   * Global (all guilds) security event counts since `since`, used by the owner
   * metrics endpoint. Counts come straight from the table.
   */
  async countAllSince(since: Date): Promise<{ total: number; critical: number }> {
    const row = await this.db.queryOne<{ total: string; critical: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE severity = 'critical')::text AS critical
         FROM security_events
        WHERE created_at >= $1`,
      [since.toISOString()],
    );
    return { total: Number(row?.total ?? '0'), critical: Number(row?.critical ?? '0') };
  }

  async protectUser(params: {
    guildId: string;
    userId: string;
    mode: 'log' | 'delete' | 'warn' | 'timeout';
    setBy: string;
    selfSelected?: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO no_tag_protected (guild_id, user_id, mode, set_by, self_selected)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         mode = EXCLUDED.mode, set_by = EXCLUDED.set_by, updated_at = now()`,
      [params.guildId, params.userId, params.mode, params.setBy, params.selfSelected ?? false],
    );
  }

  async unprotectUser(guildId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM no_tag_protected WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async protectedUsers(guildId: string): Promise<
    Array<{
      userId: string;
      mode: string;
      exemptRoleIds: string[];
      exemptUserIds: string[];
      setBy: string;
      selfSelected: boolean;
    }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM no_tag_protected WHERE guild_id = $1 ORDER BY created_at DESC',
      [guildId],
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      mode: String(row.mode),
      exemptRoleIds: (row.exempt_role_ids as string[]) ?? [],
      exemptUserIds: (row.exempt_user_ids as string[]) ?? [],
      setBy: String(row.set_by),
      selfSelected: Boolean(row.self_selected),
    }));
  }

  async isProtected(
    guildId: string,
    userId: string,
  ): Promise<{
    protected: boolean;
    mode: string;
    exemptRoleIds: string[];
    exemptUserIds: string[];
  }> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM no_tag_protected WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    const row = result.rows[0];
    if (!row) return { protected: false, mode: 'log', exemptRoleIds: [], exemptUserIds: [] };
    return {
      protected: true,
      mode: String(row.mode),
      exemptRoleIds: (row.exempt_role_ids as string[]) ?? [],
      exemptUserIds: (row.exempt_user_ids as string[]) ?? [],
    };
  }

  async setNoTagExemptions(
    guildId: string,
    userId: string,
    roleIds: string[],
    userIds: string[],
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE no_tag_protected
          SET exempt_role_ids = $3::text[], exempt_user_ids = $4::text[], updated_at = now()
        WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId, roleIds, userIds],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recordNoTagViolation(params: {
    guildId: string;
    channelId: string | null;
    messageId: string | null;
    protectedUserId: string;
    offenderId: string;
    actionTaken: string;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO no_tag_violations (guild_id, channel_id, message_id, protected_user_id, offender_id, action_taken)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        params.guildId,
        params.channelId,
        params.messageId,
        params.protectedUserId,
        params.offenderId,
        params.actionTaken,
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async noTagViolations(
    guildId: string,
    limit = 25,
  ): Promise<
    Array<{
      id: number;
      offenderId: string;
      protectedUserId: string;
      actionTaken: string;
      createdAt: Date;
    }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM no_tag_violations WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
      [guildId, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      offenderId: String(row.offender_id),
      protectedUserId: String(row.protected_user_id),
      actionTaken: String(row.action_taken),
      createdAt: new Date(String(row.created_at)),
    }));
  }

  async violationsByOffender(guildId: string, offenderId: string, since: Date): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM no_tag_violations
        WHERE guild_id = $1 AND offender_id = $2 AND created_at >= $3`,
      [guildId, offenderId, since],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  // --- /no-pin ---------------------------------------------------------------

  async recordPinEvent(params: {
    guildId: string;
    channelId: string;
    pinned: boolean;
    actorId?: string | null;
    actorSource?: 'audit_log' | 'message_author' | 'unknown';
    messageId?: string | null;
    actionTaken?: string;
    detail?: Record<string, unknown>;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO no_pin_events (guild_id, channel_id, pinned, actor_id, actor_source, message_id, action_taken, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        params.guildId,
        params.channelId,
        params.pinned,
        params.actorId ?? null,
        params.actorSource ?? 'unknown',
        params.messageId ?? null,
        params.actionTaken ?? 'none',
        JSON.stringify(params.detail ?? {}),
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async pinEvents(
    guildId: string,
    limit = 25,
    channelId?: string,
  ): Promise<
    Array<{
      id: number;
      channelId: string;
      pinned: boolean;
      actorId: string | null;
      actorSource: string;
      actionTaken: string;
      createdAt: Date;
    }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      channelId
        ? 'SELECT * FROM no_pin_events WHERE guild_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT $3'
        : 'SELECT * FROM no_pin_events WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
      channelId ? [guildId, channelId, limit] : [guildId, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      channelId: String(row.channel_id),
      pinned: Boolean(row.pinned),
      actorId: (row.actor_id as string | null) ?? null,
      actorSource: String(row.actor_source),
      actionTaken: String(row.action_taken),
      createdAt: new Date(String(row.created_at)),
    }));
  }

  /**
   * Retention sweep for the security tables. Replaces the SQL-side prune
   * function so the behaviour is testable and observable from TypeScript.
   */
  async pruneOldRows(retentionDays = 90): Promise<{
    securityEvents: number;
    noTagViolations: number;
    noPinEvents: number;
  }> {
    return prune(this.db);

    async function prune(client: Queryable) {
      const cutoff = `now() - ($1 || ' days')::interval`;
      const events = await client.query(
        `DELETE FROM security_events WHERE created_at < ${cutoff}`,
        [String(retentionDays)],
      );
      const noTag = await client.query(
        `DELETE FROM no_tag_violations WHERE created_at < ${cutoff}`,
        [String(retentionDays)],
      );
      const noPin = await client.query(`DELETE FROM no_pin_events WHERE created_at < ${cutoff}`, [
        String(retentionDays),
      ]);
      return {
        securityEvents: events.rowCount ?? 0,
        noTagViolations: noTag.rowCount ?? 0,
        noPinEvents: noPin.rowCount ?? 0,
      };
    }
  }
}

function mapSettings(row: Record<string, unknown>): SecuritySettings {
  return {
    guildId: String(row.guild_id),
    antiNukeEnabled: Boolean(row.anti_nuke_enabled),
    antiRaidEnabled: Boolean(row.anti_raid_enabled),
    antiSpamEnabled: Boolean(row.anti_spam_enabled),
    joinThreshold: Number(row.join_threshold),
    joinWindowMs: Number(row.join_window_ms),
    spamThreshold: Number(row.spam_threshold),
    spamWindowMs: Number(row.spam_window_ms),
    mentionThreshold: Number(row.mention_threshold),
    minAccountAgeDays: Number(row.min_account_age_days),
    lockdownOnTrigger: Boolean(row.lockdown_on_trigger),
    alertChannelId: (row.alert_channel_id as string | null) ?? null,
    configHistory: (row.config_history as Array<Record<string, unknown>>) ?? [],
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapEvent(row: Record<string, unknown>): SecurityEvent {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    type: row.type as SecurityEventType,
    severity: row.severity as SecuritySeverity,
    actorId: (row.actor_id as string | null) ?? null,
    channelId: (row.channel_id as string | null) ?? null,
    detail: (row.detail as Record<string, unknown>) ?? {},
    actionTaken: (row.action_taken as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
  };
}
