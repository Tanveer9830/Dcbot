import { SNOWFLAKE_REGEX } from './constants.js';

/** Discord epoch: 2015-01-01T00:00:00.000Z */
export const DISCORD_EPOCH = 1420070400000n;

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE_REGEX.test(value);
}

/**
 * Parses a comma separated list of user IDs (e.g. BOT_OWNER_IDS) into a
 * de-duplicated array. Returns the offending token in `invalid` so the caller
 * can fail loudly instead of silently dropping an owner.
 */
export function parseIdList(raw: string | undefined | null): {
  ids: string[];
  invalid: string[];
} {
  const ids: string[] = [];
  const invalid: string[] = [];
  if (!raw) return { ids, invalid };
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (isSnowflake(trimmed)) {
      if (!ids.includes(trimmed)) ids.push(trimmed);
    } else {
      invalid.push(trimmed);
    }
  }
  return { ids, invalid };
}

/** Extracts the creation timestamp of a snowflake. */
export function snowflakeTimestamp(snowflake: string): Date | null {
  if (!isSnowflake(snowflake)) return null;
  try {
    const ms = (BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
    return new Date(Number(ms));
  } catch {
    return null;
  }
}

/** True when the account represented by the snowflake is younger than `maxAgeMs`. */
export function isYoungAccount(snowflake: string, maxAgeMs: number, now = Date.now()): boolean {
  const created = snowflakeTimestamp(snowflake);
  if (!created) return false;
  return now - created.getTime() < maxAgeMs;
}

/** Masks a snowflake for logs: 1131248987173814336 -> 11312…4336 */
export function maskId(id: string): string {
  if (id.length <= 10) return `${id.slice(0, 2)}…`;
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}
