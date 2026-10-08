import type { Repositories } from '../database/repositories.js';
import type { Logger } from '../utils/logger.js';
import { RecentItemsTracker } from '../security/trackers.js';
import {
  capsRatio,
  containsInviteLink,
  detectCaps,
  detectMentionSpam,
  detectRepeat,
  scanLinks,
  type Detection,
} from '../security/thresholds.js';

export interface AutoModConfig {
  enabled: boolean;
  blockSpam: boolean;
  blockMentions: boolean;
  mentionThreshold: number;
  blockLinks: boolean;
  linkAllowlist: string[];
  blockInvites: boolean;
  blockCaps: boolean;
  capsRatio: number;
  capsMinLength: number;
  blockRepeated: boolean;
  blockedWords: string[];
  exemptRoleIds: string[];
  exemptUserIds: string[];
  exemptChannelIds: string[];
  action: 'log' | 'delete' | 'warn' | 'timeout';
  warnThreshold: number;
}

export const DEFAULT_AUTOMOD: AutoModConfig = {
  enabled: false,
  blockSpam: false,
  blockMentions: false,
  mentionThreshold: 10,
  blockLinks: false,
  linkAllowlist: [],
  blockInvites: true,
  blockCaps: false,
  capsRatio: 0.7,
  capsMinLength: 20,
  blockRepeated: false,
  blockedWords: [],
  exemptRoleIds: [],
  exemptUserIds: [],
  exemptChannelIds: [],
  action: 'log',
  warnThreshold: 3,
};

export interface AutoModVerdict {
  blocked: boolean;
  rule: string | null;
  reason: string;
  detections: Detection[];
  matchedWords: string[];
}

/**
 * AutoMod service.
 *
 * The evaluation function is pure so each rule can be tested in isolation.
 * Note that Discord delivers the message before the bot sees it, so "block"
 * means "delete immediately and act on the author" - it cannot unsend what was
 * already pushed to clients.
 */
export class AutoModService {
  private readonly history = new RecentItemsTracker<string>(10, 20_000);

  constructor(
    private readonly repos: Repositories,
    private readonly logger: Logger,
  ) {}

  async config(guildId: string): Promise<AutoModConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_AUTOMOD, ...((settings.automod ?? {}) as Partial<AutoModConfig>) };
  }

  async update(guildId: string, patch: Partial<AutoModConfig>): Promise<AutoModConfig> {
    const config = { ...(await this.config(guildId)), ...patch };
    // Guard rails so a misconfiguration cannot lock the server down.
    config.mentionThreshold = Math.max(1, Math.min(100, config.mentionThreshold));
    config.capsRatio = Math.max(0.1, Math.min(1, config.capsRatio));
    config.capsMinLength = Math.max(5, Math.min(2000, config.capsMinLength));
    config.blockedWords = config.blockedWords
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0)
      .slice(0, 500);
    config.warnThreshold = Math.max(1, Math.min(20, config.warnThreshold));
    await this.repos.guilds.updateSettingsGroup(guildId, 'automod', config as unknown as Record<string, unknown>);
    return config;
  }

  /** Pure rule evaluation. */
  evaluate(params: {
    config: AutoModConfig;
    content: string;
    mentionCount: number;
    userId: string;
    roleIds: readonly string[];
    channelId: string;
    history: readonly string[];
    authorIsBot: boolean;
    authorIsStaff: boolean;
  }): AutoModVerdict {
    const { config } = params;
    const noMatch: AutoModVerdict = {
      blocked: false,
      rule: null,
      reason: 'no rule matched',
      detections: [],
      matchedWords: [],
    };
    if (!config.enabled) return { ...noMatch, reason: 'automod disabled' };
    if (params.authorIsBot) return { ...noMatch, reason: 'author is a bot' };
    if (params.authorIsStaff) return { ...noMatch, reason: 'author is staff' };
    if (config.exemptUserIds.includes(params.userId)) return { ...noMatch, reason: 'author exempt' };
    if (config.exemptChannelIds.includes(params.channelId)) return { ...noMatch, reason: 'channel exempt' };
    if (params.roleIds.some((role) => config.exemptRoleIds.includes(role))) {
      return { ...noMatch, reason: 'author holds an exempt role' };
    }

    const detections: Detection[] = [];
    const content = params.content ?? '';

    if (config.blockInvites && containsInviteLink(content)) {
      return {
        blocked: true,
        rule: 'invites',
        reason: 'message contains a Discord invite link',
        detections,
        matchedWords: [],
      };
    }

    if (config.blockLinks) {
      const scan = scanLinks(content, config.linkAllowlist);
      if (scan.triggered) {
        return {
          blocked: true,
          rule: 'links',
          reason: `suspicious link host(s): ${scan.suspicious.join(', ')}`,
          detections,
          matchedWords: [],
        };
      }
    }

    const matchedWords: string[] = [];
    if (config.blockedWords.length > 0) {
      const lower = content.toLowerCase();
      for (const word of config.blockedWords) {
        if (lower.includes(word)) matchedWords.push(word);
      }
      if (matchedWords.length > 0) {
        return {
          blocked: true,
          rule: 'blocked_words',
          reason: `blocked word(s): ${matchedWords.join(', ')}`,
          detections,
          matchedWords,
        };
      }
    }

    if (config.blockMentions) {
      const detection = detectMentionSpam(params.mentionCount, config.mentionThreshold);
      detections.push(detection);
      if (detection.triggered) {
        return {
          blocked: true,
          rule: 'mentions',
          reason: detection.reason,
          detections,
          matchedWords,
        };
      }
    }

    if (config.blockCaps) {
      const detection = detectCaps(content, config.capsMinLength, config.capsRatio);
      detections.push(detection);
      if (detection.triggered) {
        return { blocked: true, rule: 'caps', reason: detection.reason, detections, matchedWords };
      }
    }

    if (config.blockRepeated) {
      const detection = detectRepeat([...params.history, content]);
      detections.push(detection);
      if (detection.triggered) {
        return { blocked: true, rule: 'repeat', reason: detection.reason, detections, matchedWords };
      }
    }

    return { blocked: false, rule: null, reason: 'no rule matched', detections, matchedWords };
  }

  /** Records the message for repeat detection and evaluates it. */
  async inspect(params: {
    guildId: string;
    content: string;
    mentionCount: number;
    userId: string;
    roleIds: readonly string[];
    channelId: string;
    authorIsBot: boolean;
    authorIsStaff: boolean;
  }): Promise<AutoModVerdict> {
    const config = await this.config(params.guildId);
    const key = `${params.guildId}:${params.userId}`;
    const history = this.history.push(key, params.content);
    return this.evaluate({ ...params, config, history: history.slice(0, -1) });
  }

  /** Caps ratio for the dashboard's live preview. */
  previewCaps(content: string): number {
    return Number(capsRatio(content).toFixed(3));
  }

  getRecent(key: string): string[] {
    return this.history.get(key);
  }
}

export { DEFAULT_AUTOMOD as AUTOMOD_DEFAULTS };
export type { Logger };
