import type { Queryable } from './client.js';

/** Anything able to run work inside a transaction (Database or a test double). */
export interface Transactional {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
}

export function isTransactional(value: unknown): value is Transactional {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { transaction?: unknown }).transaction === 'function'
  );
}
