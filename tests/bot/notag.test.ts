import { describe, expect, it } from 'vitest';
import { evaluateNoTag, type NoTagMode } from '../../apps/bot/src/security/noTag.js';

const PROTECTED = '200000000000000001';
const OFFENDER = '200000000000000002';

function entry(
  mode: NoTagMode,
  overrides: Partial<Parameters<typeof evaluateNoTag>[0]['protectedUsers'][number]> = {},
) {
  return {
    userId: PROTECTED,
    mode,
    exemptRoleIds: [] as readonly string[],
    exemptUserIds: [] as readonly string[],
    ...overrides,
  };
}

const base = {
  enabled: true,
  protectedUsers: [entry('delete')],
  mentionedUserIds: [PROTECTED],
  offenderId: OFFENDER,
  offenderRoleIds: [] as readonly string[],
  offenderIsBot: false,
  offenderIsStaff: false,
};

describe('/no-tag decision logic', () => {
  it('acts when a protected user is mentioned', () => {
    const decision = evaluateNoTag(base);
    expect(decision.protected).toBe(true);
    expect(decision.exempt).toBe(false);
    expect(decision.matchedUserId).toBe(PROTECTED);
    expect(decision.mode).toBe('delete');
  });

  it('does nothing when the feature is off', () => {
    expect(evaluateNoTag({ ...base, enabled: false }).protected).toBe(false);
  });

  it('does nothing when no protected user was mentioned', () => {
    expect(evaluateNoTag({ ...base, mentionedUserIds: ['299999999999999999'] }).protected).toBe(
      false,
    );
  });

  it('never flags someone for mentioning themselves', () => {
    const decision = evaluateNoTag({
      ...base,
      offenderId: PROTECTED,
      mentionedUserIds: [PROTECTED],
    });
    expect(decision.protected).toBe(false);
  });

  it('exempts bots and server staff, logging rather than deleting', () => {
    for (const overrides of [{ offenderIsBot: true }, { offenderIsStaff: true }]) {
      const decision = evaluateNoTag({ ...base, ...overrides });
      expect(decision.protected).toBe(true);
      expect(decision.exempt).toBe(true);
      expect(decision.mode).toBe('log');
    }
  });

  it('honours per-user and per-role exemptions', () => {
    const byUser = evaluateNoTag({
      ...base,
      protectedUsers: [entry('delete', { exemptUserIds: [OFFENDER] })],
    });
    expect(byUser.exempt).toBe(true);
    expect(byUser.mode).toBe('log');

    const byRole = evaluateNoTag({
      ...base,
      protectedUsers: [entry('timeout', { exemptRoleIds: ['300000000000000001'] })],
      offenderRoleIds: ['300000000000000001'],
    });
    expect(byRole.exempt).toBe(true);
    expect(byRole.mode).toBe('log');
  });

  it('applies the mode the protected user chose', () => {
    for (const mode of ['log', 'warn', 'timeout'] as const) {
      expect(evaluateNoTag({ ...base, protectedUsers: [entry(mode)] }).mode).toBe(mode);
    }
  });
});
