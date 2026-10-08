import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LevelingRepository } from '@dcbot/database';
import { levelForXp, xpForLevel } from '@dcbot/shared';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

describe('leveling repository', () => {
  it('awards XP once per cooldown window', async () => {
    const guild = '920000000000000001';
    const user = '920000000000000002';
    const leveling = new LevelingRepository(db, 60_000);

    const first = await leveling.awardXp({ guildId: guild, userId: user, amount: 25 });
    expect(first.awarded).toBe(25);
    expect(first.profile.xp).toBe(25);

    const second = await leveling.awardXp({ guildId: guild, userId: user, amount: 25 });
    expect(second.awarded).toBe(0); // blocked by the per-user cooldown
    expect(second.profile.xp).toBe(25);
  });

  it('applies the multiplier and floors the result', async () => {
    const guild = '920000000000000003';
    const user = '920000000000000004';
    const leveling = new LevelingRepository(db, 60_000);

    const result = await leveling.awardXp({ guildId: guild, userId: user, amount: 10, multiplier: 1.55 });
    expect(result.awarded).toBe(15);
  });

  it('levels up across the curve boundary and reports the roles to grant', async () => {
    const guild = '920000000000000005';
    const user = '920000000000000006';
    const leveling = new LevelingRepository(db, 1); // 1ms cooldown so awards stack

    await leveling.setRoleReward(guild, 1, 'role-level-1');
    await leveling.setRoleReward(guild, 2, 'role-level-2');

    // 400 XP is exactly level 2 on the 100 * N^2 curve.
    const first = await leveling.awardXp({ guildId: guild, userId: user, amount: 100 });
    expect(first.leveledUp).toBe(true);
    expect(first.profile.level).toBe(1);
    expect(first.newRoles).toEqual(['role-level-1']);

    const second = await leveling.awardXp({ guildId: guild, userId: user, amount: 300 });
    expect(second.profile.xp).toBe(400);
    expect(second.profile.level).toBe(2);
    expect(second.newRoles).toEqual(['role-level-2']);

    expect(xpForLevel(2)).toBe(400);
    expect(levelForXp(399)).toBe(1);
  });

  it('never grants roles when XP goes down', async () => {
    const guild = '920000000000000007';
    const user = '920000000000000008';
    const leveling = new LevelingRepository(db, 1);

    await leveling.setXp(guild, user, 900); // level 3
    await leveling.setRoleReward(guild, 1, 'role-level-1');

    const result = await leveling.awardXp({ guildId: guild, userId: user, amount: 0 });
    expect(result.awarded).toBe(0);
    expect(result.leveledUp).toBe(false);
    expect(result.newRoles).toEqual([]);
  });

  it('computes a rank that matches the leaderboard position', async () => {
    const guild = '920000000000000009';
    const leveling = new LevelingRepository(db, 1);
    await leveling.setXp(guild, '920000000000000010', 100);
    await leveling.setXp(guild, '920000000000000011', 900);
    await leveling.setXp(guild, '920000000000000012', 400);

    const board = await leveling.leaderboard(guild, 10);
    expect(board.map((row) => row.userId)).toEqual([
      '920000000000000011',
      '920000000000000012',
      '920000000000000010',
    ]);
    expect(await leveling.rankOf(guild, '920000000000000012')).toBe(2);
    expect(await leveling.rankOf(guild, '920000000000000099')).toBeNull();
  });

  it('clamps XP at zero and recomputes the level on admin set', async () => {
    const guild = '920000000000000013';
    const user = '920000000000000014';
    const leveling = new LevelingRepository(db, 1);

    const negative = await leveling.setXp(guild, user, -500);
    expect(negative.xp).toBe(0);
    expect(negative.level).toBe(0);

    const fractional = await leveling.setXp(guild, user, 449.9);
    expect(fractional.xp).toBe(449);
    expect(fractional.level).toBe(2);
  });
});
