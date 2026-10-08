import { describe, expect, it } from 'vitest';
import { PERMISSION_BIT } from '@dcbot/shared';
import {
  capsRatio,
  containsInviteLink,
  countInWindow,
  DEFAULT_THRESHOLDS,
  detectCaps,
  detectDangerousPermissionChange,
  detectMassAction,
  detectMentionSpam,
  detectRaid,
  detectRepeat,
  detectSpam,
  detectSuspiciousAccount,
  escalate,
  scanLinks,
  type Thresholds,
} from '../../apps/bot/src/security/thresholds.js';

const NOW = Date.UTC(2025, 0, 1, 12, 0, 0);

function recent(count: number, windowMs: number, now = NOW): number[] {
  return Array.from(
    { length: count },
    (_, index) => now - Math.floor((index * windowMs) / (count + 1)),
  );
}

describe('security thresholds', () => {
  it('counts only timestamps inside the trailing window', () => {
    expect(countInWindow([NOW, NOW - 1_000, NOW - 60_000], 5_000, NOW)).toBe(2);
    expect(countInWindow([], 5_000, NOW)).toBe(0);
  });

  it('fires anti-raid at the join threshold and escalates with overshoot', () => {
    const thresholds: Thresholds = {
      ...DEFAULT_THRESHOLDS,
      joinThreshold: 5,
      joinWindowMs: 10_000,
    };

    expect(detectRaid(recent(4, 10_000, NOW), thresholds, NOW).triggered).toBe(false);

    const at = detectRaid(recent(5, 10_000, NOW), thresholds, NOW);
    expect(at.triggered).toBe(true);
    expect(at.severity).toBe('medium');

    expect(detectRaid(recent(10, 10_000, NOW), thresholds, NOW).severity).toBe('high');
    expect(detectRaid(recent(20, 10_000, NOW), thresholds, NOW).severity).toBe('critical');
  });

  it('ignores joins outside the window', () => {
    const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, joinThreshold: 3, joinWindowMs: 5_000 };
    const oldJoins = [NOW - 60_000, NOW - 61_000, NOW - 62_000, NOW - 63_000];
    expect(detectRaid(oldJoins, thresholds, NOW).triggered).toBe(false);
  });

  it('fires anti-spam on message rate', () => {
    const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, spamThreshold: 5, spamWindowMs: 5_000 };
    expect(detectSpam(recent(4, 5_000, NOW), thresholds, NOW).triggered).toBe(false);
    const fired = detectSpam(recent(6, 5_000, NOW), thresholds, NOW);
    expect(fired.triggered).toBe(true);
    expect(fired.reason).toContain('messages');
  });

  it('flags mass mentions', () => {
    expect(detectMentionSpam(9, 10).triggered).toBe(false);
    expect(detectMentionSpam(10, 10).triggered).toBe(true);
    expect(detectMentionSpam(30, 10).severity).toBe('high');
  });

  it('detects invite links and suspicious hosts', () => {
    expect(containsInviteLink('join discord.gg/abcdef')).toBe(true);
    expect(containsInviteLink('https://discord.com/invite/abcdef')).toBe(true);
    expect(containsInviteLink('discordapp.com/invite/abcdef')).toBe(true);
    expect(containsInviteLink('no link here')).toBe(false);

    const scan = scanLinks('hi https://bit.ly/abc and https://example.com/x', ['example.com']);
    expect(scan.urls).toHaveLength(2);
    expect(scan.shortened).toContain('bit.ly');
    expect(scan.triggered).toBe(true);
    expect(scan.suspicious).not.toContain('example.com');

    expect(scanLinks('clean https://example.com').triggered).toBe(false);
  });

  it('measures caps ratio on letters only', () => {
    expect(capsRatio('HELLO')).toBe(1);
    expect(capsRatio('hello')).toBe(0);
    expect(capsRatio('HeLLo')).toBeCloseTo(0.6, 5);
    expect(capsRatio('12345 🎉')).toBe(0); // no letters, no punishment
    expect(detectCaps('STOP SHOUTING AT ME', 10, 0.8).triggered).toBe(true);
    expect(detectCaps('hi', 10, 0.8).triggered).toBe(false);
    expect(detectCaps('a normal sentence here', 10, 0.8).triggered).toBe(false);
  });

  it('detects a repeated message but ignores very short ones', () => {
    expect(detectRepeat(['buy now', 'buy now', 'buy now']).triggered).toBe(true);
    expect(detectRepeat(['buy now', 'buy now']).triggered).toBe(false);
    expect(detectRepeat(['hi', 'hi', 'hi']).triggered).toBe(false);
    expect(detectRepeat(['Buy Now', 'buy now', 'BUY NOW']).triggered).toBe(true); // case/space insensitive
  });

  it('flags freshly created accounts only when the check is enabled', () => {
    const fresh = String((BigInt(NOW - 3_600_000) - 1420070400000n) << 22n);
    expect(detectSuspiciousAccount(fresh, 0, NOW).triggered).toBe(false); // disabled
    expect(detectSuspiciousAccount(fresh, 7, NOW).triggered).toBe(true);

    const old = String((BigInt(NOW - 30 * 86_400_000) - 1420070400000n) << 22n);
    expect(detectSuspiciousAccount(old, 7, NOW).triggered).toBe(false);
  });

  it('flags mass bans and mass kicks as critical', () => {
    const action = detectMassAction(recent(6, 10_000, NOW), 5, 10_000, 'ban', NOW);
    expect(action.triggered).toBe(true);
    expect(action.severity).toBe('critical');
    expect(action.reason).toContain('ban');
    expect(detectMassAction(recent(2, 10_000, NOW), 5, 10_000, 'kick', NOW).triggered).toBe(false);
  });

  it('names the dangerous permissions that were just granted', () => {
    const before = PERMISSION_BIT.SEND_MESSAGES;
    const after =
      PERMISSION_BIT.SEND_MESSAGES | PERMISSION_BIT.ADMINISTRATOR | PERMISSION_BIT.MANAGE_WEBHOOKS;
    const change = detectDangerousPermissionChange(before, after);
    expect(change.triggered).toBe(true);
    expect(change.granted).toContain('Administrator');
    expect(change.granted).toContain('Manage Webhooks');
    expect(change.granted).not.toContain('Send Messages');

    // Removing a permission is not an escalation.
    expect(detectDangerousPermissionChange(after, before).triggered).toBe(false);
  });

  it('escalates based on recent history', () => {
    expect(escalate({ critical: 1, high: 0, medium: 0, low: 9 })).toBe('critical');
    expect(escalate({ critical: 0, high: 3, medium: 0, low: 0 })).toBe('critical');
    expect(escalate({ critical: 0, high: 1, medium: 0, low: 0 })).toBe('high');
    expect(escalate({ critical: 0, high: 0, medium: 3, low: 0 })).toBe('medium');
    expect(escalate({ critical: 0, high: 0, medium: 2, low: 5 })).toBe('low');
  });
});
