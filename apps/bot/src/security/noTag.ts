import type { SecurityRepository } from '@dcbot/database';
import { AuthorizationError, isSnowflake } from '@dcbot/shared';

/**
 * /no-tag - mention protection.
 *
 * What this can and cannot do (documented in docs/COMMANDS.md):
 *  - Discord does NOT provide a pre-send hook for mentions, so the bot cannot
 *    prevent a mention from being delivered. It can delete the offending
 *    message afterwards and act on the author.
 *  - Mentions inside a DM, in another server, or in an edited message that the
 *    bot never saw are out of reach.
 *  - The bot cannot delete messages it lacks Manage Messages for.
 */

export type NoTagMode = 'log' | 'delete' | 'warn' | 'timeout';

export interface NoTagDecision {
  protected: boolean;
  matchedUserId: string | null;
  mode: NoTagMode;
  exempt: boolean;
  reason: string;
}

/**
 * Pure decision function. Given the set of protected users, the users actually
 * mentioned, and the offender's roles, decide what to do.
 */
export function evaluateNoTag(params: {
  enabled: boolean;
  protectedUsers: ReadonlyArray<{
    userId: string;
    mode: NoTagMode;
    exemptRoleIds: readonly string[];
    exemptUserIds: readonly string[];
  }>;
  mentionedUserIds: readonly string[];
  offenderId: string;
  offenderRoleIds: readonly string[];
  offenderIsBot: boolean;
  offenderIsStaff: boolean;
}): NoTagDecision {
  const none: NoTagDecision = {
    protected: false,
    matchedUserId: null,
    mode: 'log',
    exempt: false,
    reason: 'no protected user was mentioned',
  };
  if (!params.enabled) return { ...none, reason: 'no-tag protection is disabled' };

  // A user mentioning themselves is never a violation.
  const mentioned = params.mentionedUserIds.filter((id) => id !== params.offenderId);
  const match = params.protectedUsers.find((entry) => mentioned.includes(entry.userId));
  if (!match) return none;

  if (params.offenderIsBot) {
    return { protected: true, matchedUserId: match.userId, mode: 'log', exempt: true, reason: 'author is a bot' };
  }
  if (params.offenderIsStaff) {
    return {
      protected: true,
      matchedUserId: match.userId,
      mode: 'log',
      exempt: true,
      reason: 'author is server staff',
    };
  }
  if (match.exemptUserIds.includes(params.offenderId)) {
    return {
      protected: true,
      matchedUserId: match.userId,
      mode: 'log',
      exempt: true,
      reason: 'author is exempt for this user',
    };
  }
  if (params.offenderRoleIds.some((role) => match.exemptRoleIds.includes(role))) {
    return {
      protected: true,
      matchedUserId: match.userId,
      mode: 'log',
      exempt: true,
      reason: 'author holds an exempt role',
    };
  }

  return {
    protected: true,
    matchedUserId: match.userId,
    mode: match.mode,
    exempt: false,
    reason: `mentioned a protected user (${match.mode})`,
  };
}

export class NoTagService {
  constructor(private readonly security: SecurityRepository) {}

  /**
   * Authorization for changing someone else's protection.
   * Only the user themselves (self-select) or server staff/bot owners may.
   */
  assertCanManage(params: {
    actorId: string;
    targetUserId: string;
    actorIsStaff: boolean;
    actorIsOwner: boolean;
  }): void {
    if (params.actorIsOwner) return;
    if (params.actorId === params.targetUserId) return;
    if (params.actorIsStaff) return;
    throw new AuthorizationError('You can only manage your own mention protection unless you are server staff.');
  }

  async listProtected(guildId: string) {
    const rows = await this.security.protectedUsers(guildId);
    return rows.map((row) => ({ ...row, mode: row.mode as NoTagMode }));
  }

  async protect(params: {
    guildId: string;
    userId: string;
    mode: NoTagMode;
    setBy: string;
    selfSelected?: boolean;
  }): Promise<void> {
    if (!isSnowflake(params.userId)) throw new AuthorizationError('Invalid user.');
    await this.security.protectUser(params);
  }

  async violations(guildId: string, limit = 25) {
    return this.security.noTagViolations(guildId, limit);
  }
}
