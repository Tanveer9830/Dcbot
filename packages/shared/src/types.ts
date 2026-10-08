/**
 * Types shared between the bot, the dashboard and the database layer.
 * These are plain data shapes - no runtime dependencies.
 */

export type Snowflake = string;

/** Shape of a per-guild feature configuration block stored as JSONB. */
export interface GuildFeatureConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface ModerationCase {
  id: number;
  guildId: Snowflake;
  caseNumber: number;
  type: ModerationActionType;
  targetId: Snowflake;
  actorId: Snowflake;
  reason: string;
  evidenceUrl?: string | null;
  expiresAt?: Date | null;
  revoked: boolean;
  createdAt: Date;
}

export type ModerationActionType =
  | 'ban'
  | 'unban'
  | 'kick'
  | 'timeout'
  | 'untimeout'
  | 'warn'
  | 'purge'
  | 'lock'
  | 'unlock'
  | 'softban'
  | 'nickname'
  | 'role_add'
  | 'role_remove'
  | 'note';

export interface Warning {
  id: number;
  guildId: Snowflake;
  userId: Snowflake;
  moderatorId: Snowflake;
  reason: string;
  acknowledged: boolean;
  createdAt: Date;
}

export type SecurityEventType =
  | 'anti_nuke'
  | 'anti_raid'
  | 'anti_spam'
  | 'anti_flood'
  | 'suspicious_account'
  | 'dangerous_permission_change'
  | 'role_deleted'
  | 'channel_deleted'
  | 'webhook_update'
  | 'mass_ban'
  | 'mass_kick'
  | 'no_tag_violation'
  | 'no_pin_event'
  | 'lockdown'
  | 'unusual_admin_activity';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEvent {
  id: number;
  guildId: Snowflake;
  type: SecurityEventType;
  severity: SecuritySeverity;
  actorId?: Snowflake | null;
  channelId?: Snowflake | null;
  detail: Record<string, unknown>;
  actionTaken?: string | null;
  createdAt: Date;
}

export type TicketStatus = 'open' | 'claimed' | 'closed';

export interface Ticket {
  id: number;
  guildId: Snowflake;
  channelId: Snowflake;
  openerId: Snowflake;
  claimedById?: Snowflake | null;
  categoryId?: string | null;
  reason?: string | null;
  status: TicketStatus;
  rating?: number | null;
  createdAt: Date;
  closedAt?: Date | null;
}

export type CustomCommandScope = 'global' | 'guild';

export interface CustomCommand {
  id: number;
  scope: CustomCommandScope;
  /** Null for global commands. */
  guildId?: Snowflake | null;
  name: string;
  description: string;
  responseType: 'text' | 'embed';
  content?: string | null;
  embed?: Record<string, unknown> | null;
  ephemeral: boolean;
  deleteInvocation: boolean;
  enabled: boolean;
  createdBy: Snowflake;
  updatedBy?: Snowflake | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EconomyAccount {
  userId: Snowflake;
  guildId: Snowflake;
  wallet: number;
  bank: number;
  totalEarned: number;
  totalSpent: number;
  dailyClaimedAt?: Date | null;
  weeklyClaimedAt?: Date | null;
  workClaimedAt?: Date | null;
  updatedAt: Date;
}

export type TransactionKind =
  | 'daily'
  | 'weekly'
  | 'work'
  | 'transfer'
  | 'purchase'
  | 'sale'
  | 'admin_adjust'
  | 'quest'
  | 'achievement'
  | 'levelup'
  | 'giveaway';

export interface EconomyTransaction {
  id: number;
  guildId: Snowflake;
  userId: Snowflake;
  kind: TransactionKind;
  amount: number;
  walletAfter: number;
  bankAfter: number;
  counterpartyId?: Snowflake | null;
  memo?: string | null;
  idempotencyKey?: string | null;
  createdAt: Date;
}

export interface XpProfile {
  guildId: Snowflake;
  userId: Snowflake;
  xp: number;
  level: number;
  messages: number;
  lastXpAt?: Date | null;
}

export interface Giveaway {
  id: number;
  guildId: Snowflake;
  channelId: Snowflake;
  messageId: Snowflake;
  hostId: Snowflake;
  prize: string;
  winnerCount: number;
  endsAt: Date;
  ended: boolean;
  createdAt: Date;
}

export interface AuditEntry {
  id: number;
  guildId: Snowflake | null;
  actorId: Snowflake;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface ScheduledTask {
  id: number;
  guildId: Snowflake | null;
  kind: string;
  payload: Record<string, unknown>;
  runAt: Date;
  lastError?: string | null;
  attempts: number;
  completedAt?: Date | null;
  createdAt: Date;
}

export interface HealthSnapshot {
  service: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  latencyMs?: number | null;
  detail?: string | null;
  checkedAt: string;
}
