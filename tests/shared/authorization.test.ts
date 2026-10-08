import { describe, expect, it } from 'vitest';
import { AuthorizationError, OwnerOnlyError, OwnerPolicy } from '@dcbot/shared';

const OWNER_A = '1131248987173814336';
const OWNER_B = '1473315482554732786';
const STRANGER = '123456789012345678';

describe('OwnerPolicy', () => {
  it('recognises exactly the configured owner IDs', () => {
    const policy = new OwnerPolicy({ raw: `${OWNER_A},${OWNER_B}` });
    expect(policy.isOwner(OWNER_A)).toBe(true);
    expect(policy.isOwner(OWNER_B)).toBe(true);
    expect(policy.isOwner(STRANGER)).toBe(false);
    expect(policy.count).toBe(2);
  });

  it('gives every configured owner identical privileges', () => {
    const policy = new OwnerPolicy({ raw: `${OWNER_A},${OWNER_B}` });
    expect(policy.requireOwner(OWNER_A)).toBe(true);
    expect(policy.requireOwner(OWNER_B)).toBe(true);
  });

  it('never treats a guild Administrator as a bot owner', () => {
    const policy = new OwnerPolicy({ raw: OWNER_A });
    // A caller holding Administrator in a guild is still not a bot owner.
    expect(policy.isOwner(STRANGER)).toBe(false);
    expect(() => policy.requireOwner(STRANGER, 'manage global commands')).toThrow(OwnerOnlyError);
  });

  it('fails loudly when the owner list is empty in strict mode', () => {
    expect(() => new OwnerPolicy({ raw: '' })).toThrow(/at least one valid owner ID/);
    expect(() => new OwnerPolicy({ raw: undefined })).toThrow(/at least one valid owner ID/);
  });

  it('fails loudly when an entry is not a snowflake instead of silently dropping it', () => {
    expect(() => new OwnerPolicy({ raw: `${OWNER_A},not-an-id` })).toThrow(/invalid entries/);
    // The offending value is masked, never echoed in full.
    expect(() => new OwnerPolicy({ raw: '123456789012345678x' })).toThrowError(
      expect.objectContaining({ message: expect.not.stringContaining('123456789012345678x') }),
    );
  });

  it('accepts whitespace and duplicate entries', () => {
    const policy = new OwnerPolicy({ raw: ` ${OWNER_A} , ${OWNER_A},${OWNER_B} ` });
    expect(policy.count).toBe(2);
  });

  it('rejects non-snowflake input to isOwner instead of throwing', () => {
    const policy = new OwnerPolicy({ raw: OWNER_A });
    expect(policy.isOwner(null)).toBe(false);
    expect(policy.isOwner(undefined)).toBe(false);
    expect(policy.isOwner('')).toBe(false);
    expect(policy.isOwner('not-an-id')).toBe(false);
  });

  it('masks owner IDs for logs and the dashboard', () => {
    const policy = new OwnerPolicy({ raw: `${OWNER_A},${OWNER_B}` });
    const masked = policy.listMasked();
    expect(masked).toHaveLength(2);
    for (const entry of masked) {
      expect(entry).toContain('…');
      expect(entry.length).toBeLessThan(OWNER_A.length);
      expect([OWNER_A, OWNER_B].includes(entry)).toBe(false);
    }
  });

  it('offers a silent gate that does not reveal the owner list', () => {
    const policy = new OwnerPolicy({ raw: OWNER_A });
    expect(() => policy.requireOwnerSilently(STRANGER)).toThrow(AuthorizationError);
    expect(() => policy.requireOwnerSilently(OWNER_A)).not.toThrow();
  });
});
