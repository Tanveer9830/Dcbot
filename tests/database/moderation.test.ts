import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModerationRepository } from '@dcbot/database';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

const MOD = '930000000000000001';
const TARGET = '930000000000000002';

let db: TestDatabase;
let moderation: ModerationRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  moderation = new ModerationRepository(db);
});
afterAll(async () => {
  await db.close();
});

describe('moderation repository', () => {
  it('numbers cases sequentially per guild and keeps them separate across guilds', async () => {
    const guildA = '930000000000000010';
    const guildB = '930000000000000011';

    const a1 = await moderation.createCase({
      guildId: guildA,
      type: 'warn',
      targetId: TARGET,
      actorId: MOD,
      reason: 'first',
    });
    const a2 = await moderation.createCase({
      guildId: guildA,
      type: 'timeout',
      targetId: TARGET,
      actorId: MOD,
      reason: 'second',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const b1 = await moderation.createCase({
      guildId: guildB,
      type: 'kick',
      targetId: TARGET,
      actorId: MOD,
      reason: 'other guild',
    });

    expect([a1.caseNumber, a2.caseNumber]).toEqual([1, 2]);
    expect(b1.caseNumber).toBe(1); // numbering restarts per guild
  });

  it('creates bulk cases atomically with contiguous numbers', async () => {
    const guild = '930000000000000012';
    const created = await db.transaction((tx) =>
      moderation.createCases(
        tx,
        ['930000000000000020', '930000000000000021', '930000000000000022'].map((targetId) => ({
          guildId: guild,
          type: 'purge' as const,
          targetId,
          actorId: MOD,
          reason: 'bulk action',
        })),
      ),
    );
    expect(created).toEqual([1, 2, 3]);
  });

  it('lists a user history and lets a case be revoked', async () => {
    const guild = '930000000000000013';
    const created = await moderation.createCase({
      guildId: guild,
      type: 'ban',
      targetId: TARGET,
      actorId: MOD,
      reason: 'raid',
      evidenceUrl: 'https://example.invalid/evidence.png',
    });

    const history = await moderation.listCasesForUser(guild, TARGET, 10);
    expect(history).toHaveLength(1);
    expect(history[0]?.evidenceUrl).toBe('https://example.invalid/evidence.png');

    expect(await moderation.revokeCase(guild, created.caseNumber)).toBe(true);
    expect(await moderation.revokeCase(guild, created.caseNumber)).toBe(false); // already revoked

    const after = await moderation.listCasesForUser(guild, TARGET, 10);
    expect(after[0]?.revoked).toBe(true);
  });

  it('counts recent cases for an actor (used by anti-nuke thresholds)', async () => {
    const guild = '930000000000000014';
    const actor = '930000000000000015';
    for (let index = 0; index < 3; index += 1) {
      await moderation.createCase({
        guildId: guild,
        type: 'ban',
        targetId: `9300000000000001${index}`,
        actorId: actor,
        reason: 'threshold test',
      });
    }
    expect(await moderation.countCasesSince(guild, actor, new Date(Date.now() - 60_000))).toBe(3);
    expect(await moderation.countCasesSince(guild, actor, new Date(Date.now() + 60_000))).toBe(0);
  });

  it('stores warnings and marks them acknowledged', async () => {
    const guild = '930000000000000016';
    const warning = await moderation.addWarning({
      guildId: guild,
      userId: TARGET,
      moderatorId: MOD,
      reason: 'spam',
    });
    expect(warning.acknowledged).toBe(false);

    expect(await moderation.acknowledgeWarning(guild, warning.id)).toBe(true);
    const warnings = await moderation.warningsFor(guild, TARGET);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.acknowledged).toBe(true);
  });

  it('only lists timeouts that have not expired yet', async () => {
    const guild = '930000000000000017';
    await moderation.createCase({
      guildId: guild,
      type: 'timeout',
      targetId: '930000000000000018',
      actorId: MOD,
      reason: 'still running',
      expiresAt: new Date(Date.now() + 600_000),
    });
    await moderation.createCase({
      guildId: guild,
      type: 'timeout',
      targetId: '930000000000000019',
      actorId: MOD,
      reason: 'already over',
      expiresAt: new Date(Date.now() - 600_000),
    });

    const active = await moderation.activeTimeouts(guild);
    expect(active.map((row) => row.targetId)).toEqual(['930000000000000018']);
  });
});
