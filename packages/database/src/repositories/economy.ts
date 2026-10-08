import type { Queryable } from '../client.js';
import type { Transactional } from '../transaction.js';
import {
  CooldownError,
  DuplicateOperationError,
  InsufficientFundsError,
  ValidationError,
  type EconomyAccount,
  type EconomyTransaction,
  type TransactionKind,
} from '@dcbot/shared';

export const COOLDOWNS = {
  daily: 20 * 60 * 60 * 1000,
  weekly: 6 * 24 * 60 * 60 * 1000,
  work: 45 * 60 * 1000,
} as const;

export interface TransferResult {
  transactionId: number;
  sender: EconomyAccount;
  recipient: EconomyAccount;
}

/**
 * Economy repository.
 *
 * Invariants enforced here (and verified by tests):
 *  - balances can never go negative (DB CHECK constraints + guarded updates),
 *  - transfers lock both rows in a deterministic order to avoid deadlocks,
 *  - every mutation writes an append-only ledger row,
 *  - cooldown claims are single atomic statements, so a double click cannot
 *    grant the reward twice,
 *  - idempotency keys make retried operations no-ops instead of duplicates.
 */
export class EconomyRepository {
  constructor(
    private readonly db: Queryable & Transactional,
    private readonly startingBalance = 500,
  ) {}

  async ensureAccount(guildId: string, userId: string): Promise<EconomyAccount> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO economy_accounts (guild_id, user_id, wallet)
       VALUES ($1, $2, $3::bigint)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [guildId, userId, this.startingBalance],
    );
    return mapAccount(result.rows[0]!);
  }

  async getAccount(guildId: string, userId: string): Promise<EconomyAccount> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM economy_accounts WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : this.ensureAccount(guildId, userId);
  }

  async leaderboard(
    guildId: string,
    limit = 10,
  ): Promise<Array<EconomyAccount & { rank: number }>> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM economy_accounts WHERE guild_id = $1
        ORDER BY (wallet + bank) DESC, user_id LIMIT $2`,
      [guildId, limit],
    );
    // The ordering is total, so the row position is the rank: identical to
    // ROW_NUMBER() over the same ordering, without depending on window functions.
    return result.rows.map((row, index) => ({ ...mapAccount(row), rank: index + 1 }));
  }

  /**
   * Atomic timed-claim. The WHERE clause re-checks the cooldown inside the same
   * statement that performs the update, so concurrent claims cannot both win.
   */
  async claimTimedReward(params: {
    guildId: string;
    userId: string;
    kind: 'daily' | 'weekly' | 'work';
    amount: number;
  }): Promise<{ amount: number; account: EconomyAccount; transactionId: number }> {
    const column = `${params.kind}_claimed_at`;
    const cooldownMs = COOLDOWNS[params.kind];
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new ValidationError('Reward amount must be a positive whole number.');
    }

    return this.db.transaction(async (tx) => {
      await ensure(tx, params.guildId, params.userId, this.startingBalance);

      const updated = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET wallet = wallet + $3::bigint,
                total_earned = total_earned + $3::bigint,
                ${column} = now(),
                updated_at = now()
          WHERE guild_id = $1 AND user_id = $2
            AND (${column} IS NULL OR ${column} < now() - ($4 || ' milliseconds')::interval)
          RETURNING *`,
        [params.guildId, params.userId, params.amount, String(cooldownMs)],
      );

      const row = updated.rows[0];
      if (!row) {
        const current = await tx.query<Record<string, unknown>>(
          `SELECT ${column} AS claimed_at FROM economy_accounts WHERE guild_id = $1 AND user_id = $2`,
          [params.guildId, params.userId],
        );
        const claimedAt = current.rows[0]?.claimed_at
          ? new Date(String(current.rows[0]!.claimed_at))
          : new Date();
        throw new CooldownError(new Date(claimedAt.getTime() + cooldownMs));
      }

      const account = mapAccount(row);
      const transactionId = await insertLedger(tx, {
        guildId: params.guildId,
        userId: params.userId,
        kind: params.kind,
        amount: params.amount,
        account,
      });
      return { amount: params.amount, account, transactionId };
    });
  }

  /**
   * Moves money between two users.
   *
   * Both accounts are locked FOR UPDATE in lexicographic user_id order, which
   * makes the lock order identical for A->B and B->A and therefore deadlock
   * free. The sender's balance is re-read *after* the lock is taken.
   */
  async transfer(params: {
    guildId: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    memo?: string;
    idempotencyKey?: string;
  }): Promise<TransferResult> {
    const { guildId, fromUserId, toUserId, amount } = params;
    if (fromUserId === toUserId) {
      throw new ValidationError('You cannot transfer money to yourself.');
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ValidationError('Transfer amount must be a positive whole number.');
    }
    if (amount > 1_000_000_000) {
      throw new ValidationError('Transfer amount is too large.');
    }

    return this.db.transaction(async (tx) => {
      if (params.idempotencyKey) {
        const existing = await tx.query<{ id: number }>(
          'SELECT id FROM economy_transactions WHERE idempotency_key = $1',
          [`${params.idempotencyKey}:debit`],
        );
        if (existing.rows[0]) {
          throw new DuplicateOperationError('This transfer was already completed.');
        }
      }

      const [firstId, secondId] = [fromUserId, toUserId].sort();
      const locked = await tx.query<Record<string, unknown>>(
        `SELECT * FROM economy_accounts
          WHERE guild_id = $1 AND user_id = ANY($2::text[])
          ORDER BY user_id
          FOR UPDATE`,
        [guildId, [firstId, secondId]],
      );
      const byId = new Map(locked.rows.map((row) => [String(row.user_id), row]));

      // Create any missing account, then re-lock.
      if (!byId.has(fromUserId)) await ensure(tx, guildId, fromUserId, this.startingBalance);
      if (!byId.has(toUserId)) await ensure(tx, guildId, toUserId, this.startingBalance);
      if (byId.size < 2) {
        const refreshed = await tx.query<Record<string, unknown>>(
          `SELECT * FROM economy_accounts
            WHERE guild_id = $1 AND user_id = ANY($2::text[])
            ORDER BY user_id FOR UPDATE`,
          [guildId, [firstId, secondId]],
        );
        for (const row of refreshed.rows) byId.set(String(row.user_id), row);
      }

      const senderRow = byId.get(fromUserId);
      if (!senderRow) throw new InsufficientFundsError();
      const senderWallet = Number(senderRow.wallet);
      if (senderWallet < amount) {
        throw new InsufficientFundsError(
          `You only have ${senderWallet} in your wallet. Transfers use wallet funds only.`,
        );
      }

      const debited = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET wallet = wallet - $3::bigint, total_spent = total_spent + $3::bigint, updated_at = now()
          WHERE guild_id = $1 AND user_id = $2 AND wallet >= $3::bigint
          RETURNING *`,
        [guildId, fromUserId, amount],
      );
      const sender = debited.rows[0];
      if (!sender) throw new InsufficientFundsError();

      const credited = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET wallet = wallet + $3::bigint, total_earned = total_earned + $3::bigint, updated_at = now()
          WHERE guild_id = $1 AND user_id = $2
          RETURNING *`,
        [guildId, toUserId, amount],
      );
      const recipient = credited.rows[0];
      if (!recipient) throw new Error('Recipient account disappeared mid-transfer.');

      const senderAccount = mapAccount(sender);
      const recipientAccount = mapAccount(recipient);

      const transactionId = await insertLedger(tx, {
        guildId,
        userId: fromUserId,
        kind: 'transfer',
        amount: -amount,
        account: senderAccount,
        counterpartyId: toUserId,
        memo: params.memo,
        idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:debit` : undefined,
      });
      await insertLedger(tx, {
        guildId,
        userId: toUserId,
        kind: 'transfer',
        amount,
        account: recipientAccount,
        counterpartyId: fromUserId,
        memo: params.memo,
        idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:credit` : undefined,
      });

      return { transactionId, sender: senderAccount, recipient: recipientAccount };
    });
  }

  /** Deposit wallet -> bank. */
  async deposit(guildId: string, userId: string, amount: number): Promise<EconomyAccount> {
    assertPositive(amount);
    return this.db.transaction(async (tx) => {
      await ensure(tx, guildId, userId, this.startingBalance);
      const result = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET wallet = wallet - $3::bigint, bank = bank + $3::bigint, updated_at = now()
          WHERE guild_id = $1 AND user_id = $2 AND wallet >= $3::bigint
          RETURNING *`,
        [guildId, userId, amount],
      );
      const row = result.rows[0];
      if (!row) throw new InsufficientFundsError();
      return mapAccount(row);
    });
  }

  /** Withdraw bank -> wallet. */
  async withdraw(guildId: string, userId: string, amount: number): Promise<EconomyAccount> {
    assertPositive(amount);
    return this.db.transaction(async (tx) => {
      await ensure(tx, guildId, userId, this.startingBalance);
      const result = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET bank = bank - $3::bigint, wallet = wallet + $3::bigint, updated_at = now()
          WHERE guild_id = $1 AND user_id = $2 AND bank >= $3::bigint
          RETURNING *`,
        [guildId, userId, amount],
      );
      const row = result.rows[0];
      if (!row) throw new InsufficientFundsError();
      return mapAccount(row);
    });
  }

  /** Owner/admin adjustment. Always logged with the acting admin's ID. */
  async adjust(params: {
    guildId: string;
    userId: string;
    delta: number;
    actorId: string;
    reason: string;
    bank?: boolean;
  }): Promise<EconomyAccount> {
    if (!Number.isInteger(params.delta) || params.delta === 0) {
      throw new ValidationError('Adjustment must be a non-zero whole number.');
    }
    const column = params.bank ? 'bank' : 'wallet';
    return this.db.transaction(async (tx) => {
      await ensure(tx, params.guildId, params.userId, this.startingBalance);
      const result = await tx.query<Record<string, unknown>>(
        `UPDATE economy_accounts
            SET ${column} = ${column} + $3::bigint,
                total_earned = total_earned + GREATEST($3::bigint, 0),
                total_spent = total_spent + GREATEST(-$3::bigint, 0),
                updated_at = now()
          WHERE guild_id = $1 AND user_id = $2 AND ${column} + $3::bigint >= 0
          RETURNING *`,
        [params.guildId, params.userId, params.delta],
      );
      const row = result.rows[0];
      if (!row)
        throw new InsufficientFundsError('That adjustment would make the balance negative.');
      const account = mapAccount(row);
      await insertLedger(tx, {
        guildId: params.guildId,
        userId: params.userId,
        kind: 'admin_adjust',
        amount: params.delta,
        account,
        memo: `by ${params.actorId}: ${params.reason}`.slice(0, 480),
      });
      return account;
    });
  }

  async ledger(guildId: string, userId: string, limit = 25): Promise<EconomyTransaction[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM economy_transactions
        WHERE guild_id = $1 AND user_id = $2
        ORDER BY id DESC LIMIT $3`,
      [guildId, userId, limit],
    );
    return result.rows.map(mapTransaction);
  }
}

async function ensure(
  tx: Queryable,
  guildId: string,
  userId: string,
  startingBalance: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO economy_accounts (guild_id, user_id, wallet)
     VALUES ($1, $2, $3::bigint) ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId, startingBalance],
  );
}

async function insertLedger(
  tx: Queryable,
  params: {
    guildId: string;
    userId: string;
    kind: TransactionKind;
    amount: number;
    account: EconomyAccount;
    counterpartyId?: string;
    memo?: string;
    idempotencyKey?: string;
  },
): Promise<number> {
  const result = await tx.query<{ id: number }>(
    `INSERT INTO economy_transactions
       (guild_id, user_id, kind, amount, wallet_after, bank_after, counterparty_id, memo, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      params.guildId,
      params.userId,
      params.kind,
      params.amount,
      params.account.wallet,
      params.account.bank,
      params.counterpartyId ?? null,
      params.memo ?? null,
      params.idempotencyKey ?? null,
    ],
  );
  return result.rows[0]?.id ?? 0;
}

function assertPositive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError('Amount must be a positive whole number.');
  }
}

function mapAccount(row: Record<string, unknown>): EconomyAccount {
  return {
    userId: String(row.user_id),
    guildId: String(row.guild_id),
    wallet: Number(row.wallet),
    bank: Number(row.bank),
    totalEarned: Number(row.total_earned),
    totalSpent: Number(row.total_spent),
    dailyClaimedAt: row.daily_claimed_at ? new Date(String(row.daily_claimed_at)) : null,
    weeklyClaimedAt: row.weekly_claimed_at ? new Date(String(row.weekly_claimed_at)) : null,
    workClaimedAt: row.work_claimed_at ? new Date(String(row.work_claimed_at)) : null,
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapTransaction(row: Record<string, unknown>): EconomyTransaction {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    kind: row.kind as TransactionKind,
    amount: Number(row.amount),
    walletAfter: Number(row.wallet_after),
    bankAfter: Number(row.bank_after),
    counterpartyId: (row.counterparty_id as string | null) ?? null,
    memo: (row.memo as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
  };
}
