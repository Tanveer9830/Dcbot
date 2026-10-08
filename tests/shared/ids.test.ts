import { describe, expect, it } from 'vitest';
import { isSnowflake, isYoungAccount, maskId, parseIdList, snowflakeTimestamp } from '@dcbot/shared';

describe('snowflake helpers', () => {
  it('validates snowflake shape', () => {
    expect(isSnowflake('1131248987173814336')).toBe(true);
    expect(isSnowflake('123456789012345')).toBe(true);
    expect(isSnowflake('12345')).toBe(false);
    expect(isSnowflake('12345678901234567a')).toBe(false);
    expect(isSnowflake(123_456_789_012_345_678n)).toBe(false);
    expect(isSnowflake(null)).toBe(false);
  });

  it('parses an ID list, de-duplicating and reporting invalid tokens', () => {
    const parsed = parseIdList('1131248987173814336, 1131248987173814336 ,1473315482554732786,,');
    expect(parsed.ids).toEqual(['1131248987173814336', '1473315482554732786']);
    expect(parsed.invalid).toEqual([]);

    const broken = parseIdList('1131248987173814336,abc');
    expect(broken.ids).toEqual(['1131248987173814336']);
    expect(broken.invalid).toEqual(['abc']);

    expect(parseIdList(undefined)).toEqual({ ids: [], invalid: [] });
  });

  it('derives the creation time from a snowflake', () => {
    // Round trip: build a snowflake for a known instant and read it back.
    const instant = Date.UTC(2024, 4, 17, 12, 30, 45, 678);
    const snowflake = String((BigInt(instant) - 1420070400000n) << 22n);
    expect(snowflakeTimestamp(snowflake)?.toISOString()).toBe('2024-05-17T12:30:45.678Z');

    // A real, publicly known ID resolves to a plausible date, not the epoch.
    const created = snowflakeTimestamp('1131248987173814336');
    expect(created).not.toBeNull();
    expect(created?.getFullYear()).toBe(2023);
    expect(snowflakeTimestamp('nope')).toBeNull();
  });

  it('detects freshly created accounts', () => {
    const now = Date.now();
    const fresh = String((BigInt(now - 60_000) - 1420070400000n) << 22n);
    const old = String((BigInt(now - 400 * 86_400_000) - 1420070400000n) << 22n);

    expect(isSnowflake(fresh)).toBe(true);
    expect(isYoungAccount(fresh, 7 * 86_400_000, now)).toBe(true);
    expect(isYoungAccount(old, 7 * 86_400_000, now)).toBe(false);
    expect(isYoungAccount('not-a-snowflake', 7 * 86_400_000, now)).toBe(false);
  });

  it('masks IDs so full values never reach logs', () => {
    const masked = maskId('1131248987173814336');
    expect(masked).toBe('11312…4336');
    expect(masked).not.toContain('1131248987173814336');
    expect(maskId('12345')).toBe('12…');
  });
});
