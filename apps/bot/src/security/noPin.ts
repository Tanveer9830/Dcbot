import type { SecurityRepository } from '@dcbot/database';

/**
 * /no-pin - pin activity monitoring.
 *
 * Discord limitation, stated plainly: there is no gateway event that fires
 * *before* a pin happens and no permission that blocks Manage Messages for a
 * single action. The bot therefore observes `channelPinsUpdate`, attributes the
 * change via the audit log when it can, records it, and can optionally undo the
 * pin. Undoing is best-effort and requires Manage Messages.
 */

export type NoPinMode = 'log' | 'alert' | 'unpin';

export interface NoPinDecision {
  record: boolean;
  mode: NoPinMode;
  exempt: boolean;
  reason: string;
}

export function evaluateNoPin(params: {
  enabled: boolean;
  mode: NoPinMode;
  pinned: boolean;
  actorId: string | null;
  exemptUserIds: readonly string[];
  exemptRoleIds: readonly string[];
  actorRoleIds: readonly string[];
  actorIsStaff: boolean;
}): NoPinDecision {
  if (!params.enabled) {
    return { record: false, mode: 'log', exempt: true, reason: 'no-pin monitoring is disabled' };
  }
  if (!params.actorId) {
    return { record: true, mode: params.mode, exempt: false, reason: 'actor could not be determined' };
  }
  if (params.actorIsStaff) {
    return { record: true, mode: 'log', exempt: true, reason: 'actor is server staff' };
  }
  if (params.exemptUserIds.includes(params.actorId)) {
    return { record: true, mode: 'log', exempt: true, reason: 'actor is exempt' };
  }
  if (params.actorRoleIds.some((role) => params.exemptRoleIds.includes(role))) {
    return { record: true, mode: 'log', exempt: true, reason: 'actor holds an exempt role' };
  }
  return { record: true, mode: params.mode, exempt: false, reason: `${params.pinned ? 'pin' : 'unpin'} by non-exempt user` };
}

export class NoPinService {
  constructor(private readonly security: SecurityRepository) {}

  async log(params: {
    guildId: string;
    channelId: string;
    pinned: boolean;
    actorId?: string | null;
    actorSource?: 'audit_log' | 'message_author' | 'unknown';
    messageId?: string | null;
    actionTaken?: string;
    detail?: Record<string, unknown>;
  }): Promise<number> {
    return this.security.recordPinEvent(params);
  }

  async history(guildId: string, limit = 25, channelId?: string) {
    return this.security.pinEvents(guildId, limit, channelId);
  }
}
