import { isYoungAccount, PERMISSION_BIT, type SecuritySeverity } from '@dcbot/shared';

/**
 * Pure detection functions.
 *
 * No Discord objects and no I/O here: every function takes plain data and
 * returns a decision. That keeps the security rules unit-testable and makes it
 * obvious exactly what triggers an action.
 */

export interface Thresholds {
  joinThreshold: number;
  joinWindowMs: number;
  spamThreshold: number;
  spamWindowMs: number;
  mentionThreshold: number;
  minAccountAgeDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  joinThreshold: 5,
  joinWindowMs: 10_000,
  spamThreshold: 5,
  spamWindowMs: 5_000,
  mentionThreshold: 10,
  minAccountAgeDays: 0,
};

/** Counts how many timestamps fall inside the trailing window. */
export function countInWindow(timestamps: readonly number[], windowMs: number, now = Date.now()): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (const timestamp of timestamps) if (timestamp >= cutoff) count += 1;
  return count;
}

export interface Detection<T = unknown> {
  triggered: boolean;
  value: number;
  threshold: number;
  severity: SecuritySeverity;
  reason: string;
  detail?: T;
}

function none(reason: string, value: number, threshold: number): Detection {
  return { triggered: false, value, threshold, severity: 'low', reason };
}

/** Anti-raid: too many joins inside the window. */
export function detectRaid(joinTimestamps: readonly number[], thresholds: Thresholds, now = Date.now()): Detection {
  const value = countInWindow(joinTimestamps, thresholds.joinWindowMs, now);
  if (value < thresholds.joinThreshold) {
    return none('join rate within threshold', value, thresholds.joinThreshold);
  }
  const overshoot = value / Math.max(1, thresholds.joinThreshold);
  const severity: SecuritySeverity = overshoot >= 4 ? 'critical' : overshoot >= 2 ? 'high' : 'medium';
  return {
    triggered: true,
    value,
    threshold: thresholds.joinThreshold,
    severity,
    reason: `${value} joins in ${Math.round(thresholds.joinWindowMs / 1000)}s`,
  };
}

/** Anti-spam / anti-flood: too many messages from one user in the window. */
export function detectSpam(
  messageTimestamps: readonly number[],
  thresholds: Thresholds,
  now = Date.now(),
): Detection {
  const value = countInWindow(messageTimestamps, thresholds.spamWindowMs, now);
  if (value < thresholds.spamThreshold) {
    return none('message rate within threshold', value, thresholds.spamThreshold);
  }
  const overshoot = value / Math.max(1, thresholds.spamThreshold);
  return {
    triggered: true,
    value,
    threshold: thresholds.spamThreshold,
    severity: overshoot >= 3 ? 'high' : 'medium',
    reason: `${value} messages in ${Math.round(thresholds.spamWindowMs / 1000)}s`,
  };
}

/** Anti-mention: mass pings in a single message. */
export function detectMentionSpam(mentionCount: number, threshold: number): Detection {
  if (mentionCount < threshold) return none('mention count within threshold', mentionCount, threshold);
  return {
    triggered: true,
    value: mentionCount,
    threshold,
    severity: mentionCount >= threshold * 3 ? 'high' : 'medium',
    reason: `${mentionCount} mentions in one message`,
  };
}

const INVITE_REGEX = /(?:discord(?:\.gg|app\.com\/invite|\.com\/invite)\/)[A-Za-z0-9-]{2,}/i;
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const DANGEROUS_HOSTS = [
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'is.gd',
  'ow.ly',
  'buff.ly',
  'steamcommunity.ru',
  'discordgift.site',
];

export function containsInviteLink(content: string): boolean {
  return INVITE_REGEX.test(content);
}

export interface LinkScan {
  urls: string[];
  shortened: string[];
  suspicious: string[];
  triggered: boolean;
}

/** Finds links and flags shorteners / known-bad hosts. */
export function scanLinks(content: string, allowlist: readonly string[] = []): LinkScan {
  const urls = content.match(URL_REGEX) ?? [];
  const shortened: string[] = [];
  const suspicious: string[] = [];
  for (const url of urls) {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) continue;
    if (DANGEROUS_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) {
      suspicious.push(host);
    }
    if (host.length > 30 || /(\d{1,3}\.){3}\d{1,3}/.test(host)) suspicious.push(host);
  }
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (DANGEROUS_HOSTS.includes(host)) shortened.push(host);
    } catch {
      /* ignore */
    }
  }
  return { urls, shortened, suspicious, triggered: suspicious.length > 0 };
}

/** Caps-lock ratio check. Letters only, so emoji/CJK text is not punished. */
export function capsRatio(content: string): number {
  const letters = content.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length;
}

export function detectCaps(content: string, minLength: number, ratio: number): Detection {
  if (content.length < minLength) return none('message too short to judge', content.length, minLength);
  const actual = capsRatio(content);
  if (actual < ratio) return none('caps ratio within threshold', actual, ratio);
  return {
    triggered: true,
    value: actual,
    threshold: ratio,
    severity: 'low',
    reason: `${Math.round(actual * 100)}% uppercase`,
  };
}

/** Repeated-message detection over a short history. */
export function detectRepeat(history: readonly string[], minOccurrences = 3): Detection {
  const counts = new Map<string, number>();
  for (const message of history) {
    const key = message.trim().toLowerCase();
    if (key.length < 3) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let worst = 0;
  let worstKey = '';
  for (const [key, count] of counts) {
    if (count > worst) {
      worst = count;
      worstKey = key;
    }
  }
  if (worst < minOccurrences) return none('no repeated message', worst, minOccurrences);
  return {
    triggered: true,
    value: worst,
    threshold: minOccurrences,
    severity: 'low',
    reason: `message repeated ${worst} times: "${worstKey.slice(0, 60)}"`,
  };
}

/** Alt-account / freshly-created account detection. */
export function detectSuspiciousAccount(userId: string, minAccountAgeDays: number, now = Date.now()): Detection {
  if (minAccountAgeDays <= 0) return none('account age checks disabled', 0, 0);
  const minAgeMs = minAccountAgeDays * 86_400_000;
  if (!isYoungAccount(userId, minAgeMs, now)) {
    return none('account older than threshold', 0, minAccountAgeDays);
  }
  return {
    triggered: true,
    value: 0,
    threshold: minAccountAgeDays,
    severity: 'medium',
    reason: `account younger than ${minAccountAgeDays} day(s)`,
  };
}

/** Mass ban / mass kick detection from a rolling action log. */
export function detectMassAction(
  actionTimestamps: readonly number[],
  threshold: number,
  windowMs: number,
  label: string,
  now = Date.now(),
): Detection {
  const value = countInWindow(actionTimestamps, windowMs, now);
  if (value < threshold) return none(`${label} rate within threshold`, value, threshold);
  return {
    triggered: true,
    value,
    threshold,
    severity: 'critical',
    reason: `${value} ${label} actions in ${Math.round(windowMs / 1000)}s`,
  };
}

/**
 * Compares two role permission bitfields and names the dangerous permissions
 * that were granted. Used by anti-nuke to catch privilege escalation.
 */
export function detectDangerousPermissionChange(
  before: bigint,
  after: bigint,
): { triggered: boolean; granted: string[] } {
  const dangerous: Array<[bigint, string]> = [
    [PERMISSION_BIT.ADMINISTRATOR, 'Administrator'],
    [PERMISSION_BIT.MANAGE_GUILD, 'Manage Server'],
    [PERMISSION_BIT.MANAGE_ROLES, 'Manage Roles'],
    [PERMISSION_BIT.MANAGE_WEBHOOKS, 'Manage Webhooks'],
    [PERMISSION_BIT.MANAGE_CHANNELS, 'Manage Channels'],
    [PERMISSION_BIT.BAN_MEMBERS, 'Ban Members'],
    [PERMISSION_BIT.KICK_MEMBERS, 'Kick Members'],
    [PERMISSION_BIT.MODERATE_MEMBERS, 'Moderate Members'],
  ];
  const granted: string[] = [];
  for (const [bit, label] of dangerous) {
    const had = (before & bit) === bit;
    const has = (after & bit) === bit;
    if (!had && has) granted.push(label);
  }
  return { triggered: granted.length > 0, granted };
}

/** Escalation: how severe is the guild's recent security history? */
export function escalate(recentEventCounts: Record<SecuritySeverity, number>): SecuritySeverity {
  if (recentEventCounts.critical > 0) return 'critical';
  if (recentEventCounts.high >= 3) return 'critical';
  if (recentEventCounts.high >= 1) return 'high';
  if (recentEventCounts.medium >= 3) return 'medium';
  return 'low';
}
