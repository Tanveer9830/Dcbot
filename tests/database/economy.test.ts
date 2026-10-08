import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EconomyRepository } from '@dcbot/database';
import {
  CooldownError,
  DuplicateOperationError,
  InsufficientFundsError,
  ValidationError,
  type EconomyAccount,
} from '@dcbot/shared';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

const ALICE = '900000000000000002';
const BOB = '900000000000000003';

let db: TestDatabase;
let economy: EconomyRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  economy = new EconomyRepository(db);
});

afterAll(async () => {
  await db.close();
});

async function totalMoney(guildId: string): Promise<number> {
  const row = await db.queryOne<{ total: string }>(
    'SELECT COALESCE(SUM(wallet + bank), 0)::text AS total FROM economy_accounts WHERE guild_id = $1',
    [guildId],
  );
  return Number(row?.total ?? '0');
}

describe('economy repository', () => {
  it('seeds a new account with the starting balance exactly once', async () => {
    const guild = '900000000000000101';
    const created = await economy.ensureAccount(guild, ALICE);
    expect(created.wallet).toBe(500);
    expect(created.bank).toBe(0);

    await economy.adjust({ guildId: guild, userId: ALICE, delta: 25, actorId: ALICE, reason: 'test' });
    const after = await economy.ensureAccount(guild, ALICE);
    expect(after.wallet).toBe(525); // an existing balance must never be reset
  });

  it('creates an account on read when one does not exist', async () => {
    const account = await economy.getAccount('900000000000000102', '900000000000000103');
    expect(account.userId).toBe('900000000000000103');
    expect(account.wallet).toBe(500);
  });

  it('rejects transfers that cannot be valid before touching the database', async () => {
    const guild = '900000000000000104';
    const cases: Array<[string, Parameters<EconomyRepository['transfer']>[0]]> = [
      ['self transfer', { guildId: guild, fromUserId: ALICE, toUserId: ALICE, amount: 10 }],
      ['fractional', { guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 10.5 }],
      ['zero', { guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 0 }],
      ['negative', { guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: -5 }],
      ['over the cap', { guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 1_000_000_001 }],
    ];
    for (const [name, params] of cases) {
      await expect(economy.transfer(params), name).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await totalMoney(guild)).toBe(0); // nothing was written
  });

  it('moves funds between two users and writes both ledger sides', async () => {
    const guild = '900000000000000105';
    await economy.ensureAccount(guild, ALICE);
    await economy.ensureAccount(guild, BOB);
    const before = await totalMoney(guild);

    const result = await economy.transfer({
      guildId: guild,
      fromUserId: ALICE,
      toUserId: BOB,
      amount: 100,
      memo: 'rent',
    });

    expect(result.sender.wallet).toBe(400);
    expect(result.recipient.wallet).toBe(600);
    expect((await economy.getAccount(guild, ALICE)).wallet).toBe(400);
    expect((await economy.getAccount(guild, BOB)).wallet).toBe(600);

    const aliceLedger = await economy.ledger(guild, ALICE, 5);
    expect(aliceLedger.some((row) => row.kind === 'transfer' && row.amount === -100)).toBe(true);
    const bobLedger = await economy.ledger(guild, BOB, 5);
    expect(bobLedger.some((row) => row.kind === 'transfer' && row.amount === 100)).toBe(true);

    // A transfer moves value; it never creates or destroys it.
    expect(await totalMoney(guild)).toBe(before);
  });

  it('refuses a transfer larger than the wallet and leaves balances untouched', async () => {
    const guild = '900000000000000106';
    await economy.ensureAccount(guild, ALICE);
    await economy.ensureAccount(guild, BOB);

    await expect(
      economy.transfer({ guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 999_999 }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect((await economy.getAccount(guild, ALICE)).wallet).toBe(500);
    expect((await economy.getAccount(guild, BOB)).wallet).toBe(500);
  });

  it('treats a repeated idempotency key as a duplicate instead of paying twice', async () => {
    const guild = '900000000000000107';
    await economy.ensureAccount(guild, ALICE);
    await economy.ensureAccount(guild, BOB);
    const key = `test-${Date.now()}`;

    await economy.transfer({ guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 10, idempotencyKey: key });
    await expect(
      economy.transfer({ guildId: guild, fromUserId: ALICE, toUserId: BOB, amount: 10, idempotencyKey: key }),
    ).rejects.toBeInstanceOf(DuplicateOperationError);

    expect((await economy.getAccount(guild, BOB)).wallet).toBe(510); // paid once, not twice
    expect((await economy.getAccount(guild, ALICE)).wallet).toBe(490);
  });

  it('creates the recipient account when it does not exist yet', async () => {
    const guild = '900000000000000108';
    const stranger = '900000000000000109';
    await economy.ensureAccount(guild, BOB);

    const result = await economy.transfer({ guildId: guild, fromUserId: BOB, toUserId: stranger, amount: 5 });
    expect(result.recipient.userId).toBe(stranger);
    expect(result.recipient.wallet).toBe(505); // 500 starting balance plus the transfer
  });

  it('grants a timed reward once and then enforces the cooldown', async () => {
    const guild = '900000000000000110';
    const userId = '900000000000000111';

    const first = await economy.claimTimedReward({ guildId: guild, userId, kind: 'daily', amount: 250 });
    expect(first.amount).toBe(250);
    expect(first.account.wallet).toBe(750); // 500 starting balance plus the reward

    const error = await economy
      .claimTimedReward({ guildId: guild, userId, kind: 'daily', amount: 250 })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CooldownError);
    expect((error as CooldownError).readyAt.getTime()).toBeGreaterThan(Date.now());

    // The blocked claim must not have credited anything.
    expect((await economy.getAccount(guild, userId)).wallet).toBe(750);
  });

  it('rejects non-positive reward amounts', async () => {
    await expect(
      economy.claimTimedReward({ guildId: '900000000000000112', userId: ALICE, kind: 'work', amount: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves money between wallet and bank without losing any', async () => {
    const guild = '900000000000000113';
    const userId = '900000000000000114';
    await economy.ensureAccount(guild, userId);

    const deposited = await economy.deposit(guild, userId, 200);
    expect(deposited.wallet).toBe(300);
    expect(deposited.bank).toBe(200);

    const withdrawn = await economy.withdraw(guild, userId, 150);
    expect(withdrawn.wallet).toBe(450);
    expect(withdrawn.bank).toBe(50);

    await expect(economy.withdraw(guild, userId, 10_000)).rejects.toBeInstanceOf(InsufficientFundsError);
    await expect(economy.deposit(guild, userId, 10_000)).rejects.toBeInstanceOf(InsufficientFundsError);

    const untouched = await economy.getAccount(guild, userId);
    expect(untouched.wallet).toBe(450);
    expect(untouched.bank).toBe(50);
  });

  it('never lets an adjustment push a balance below zero', async () => {
    const guild = '900000000000000115';
    const userId = '900000000000000116';
    await economy.ensureAccount(guild, userId);

    await expect(
      economy.adjust({ guildId: guild, userId, delta: -9_999, actorId: ALICE, reason: 'test' }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    const granted = await economy.adjust({ guildId: guild, userId, delta: 1_000, actorId: ALICE, reason: 'prize' });
    expect(granted.wallet).toBe(1_500);
    expect(granted.totalEarned).toBeGreaterThanOrEqual(1_000);

    await expect(
      economy.adjust({ guildId: guild, userId, delta: 0, actorId: ALICE, reason: 'noop' }),
    ).rejects.toBeInstanceOf(ValidationError);

    const adjustment = (await economy.ledger(guild, userId, 5)).find((row) => row.kind === 'admin_adjust');
    expect(adjustment?.memo).toContain(ALICE);
    expect(adjustment?.memo).toContain('prize');
  });

  it('ranks the leaderboard by total wealth', async () => {
    const guild = '900000000000000117';
    const rich = '900000000000000118';
    const poor = '900000000000000119';
    await economy.ensureAccount(guild, rich);
    await economy.ensureAccount(guild, poor);
    await economy.adjust({ guildId: guild, userId: rich, delta: 5_000, actorId: rich, reason: 'seed' });

    const board = await economy.leaderboard(guild, 10);
    expect(board.map((row) => row.userId)).toEqual([rich, poor]);
    expect(board.map((row) => row.rank)).toEqual([1, 2]);
  });

  it('conserves money across a batch of transfers', async () => {
    const guild = '900000000000000120';
    const members = ['900000000000000121', '900000000000000122', '900000000000000123'];
    for (const member of members) await economy.ensureAccount(guild, member);
    const before = await totalMoney(guild);

    for (let index = 0; index < 10; index += 1) {
      await economy.transfer({
        guildId: guild,
        fromUserId: members[index % members.length]!,
        toUserId: members[(index + 1) % members.length]!,
        amount: 10,
      });
    }

    expect(await totalMoney(guild)).toBe(before);

    const accounts: EconomyAccount[] = [];
    for (const member of members) accounts.push(await economy.getAccount(guild, member));
    expect(accounts.every((account) => account.wallet >= 0)).toBe(true);
  });
});
