import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS } from '@dcbot/database';
import {
  isSnowflakeParam,
  isWritableSettingsGroup,
  MAX_SETTINGS_PAYLOAD_BYTES,
  validateSettingsRequest,
  WRITABLE_SETTINGS_GROUPS,
} from '../../apps/dashboard/lib/settingsPolicy.js';

describe('dashboard settings write policy', () => {
  it('exposes a fixed, known allowlist of writable groups', () => {
    expect(WRITABLE_SETTINGS_GROUPS).toContain('moderation');
    expect(WRITABLE_SETTINGS_GROUPS).toContain('leveling');
    for (const group of WRITABLE_SETTINGS_GROUPS) {
      expect(SETTINGS_GROUPS, `${group} must exist in the schema`).toContain(group);
      expect(isWritableSettingsGroup(group)).toBe(true);
    }
  });

  it('keeps branding and the tag/pin systems out of the dashboard', () => {
    for (const group of ['branding', 'no_tag', 'no_pin']) {
      expect(SETTINGS_GROUPS, `${group} should exist for the bot to use`).toContain(group);
      expect(isWritableSettingsGroup(group), `${group} must not be dashboard writable`).toBe(false);
      expect(
        validateSettingsRequest({ group, patch: { enabled: false } }),
        `${group} must be rejected`,
      ).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('rejects groups that do not exist at all, including SQL-shaped input', () => {
    for (const group of ['nope', 'guild_id; DROP TABLE guilds', '', null, undefined, 42]) {
      expect(isWritableSettingsGroup(group), String(group)).toBe(false);
      expect(validateSettingsRequest({ group, patch: {} }).ok, String(group)).toBe(false);
    }
  });

  it('accepts a valid patch and passes it through untouched', () => {
    const result = validateSettingsRequest({ group: 'welcome', patch: { enabled: true, message: 'hi {{user}}' } });
    expect(result).toEqual({ ok: true, group: 'welcome', patch: { enabled: true, message: 'hi {{user}}' } });
  });

  it('requires an object patch', () => {
    for (const patch of [null, undefined, 'text', 42, ['a'], []]) {
      const result = validateSettingsRequest({ group: 'welcome', patch });
      expect(result, JSON.stringify(patch)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('rejects payloads over the size cap', () => {
    const huge = { blob: 'x'.repeat(MAX_SETTINGS_PAYLOAD_BYTES) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_SETTINGS_PAYLOAD_BYTES);
    expect(validateSettingsRequest({ group: 'logging', patch: huge })).toMatchObject({
      ok: false,
      status: 413,
    });

    const justUnder = { blob: 'x'.repeat(100) };
    expect(validateSettingsRequest({ group: 'logging', patch: justUnder }).ok).toBe(true);
  });

  it('rejects bodies that are not objects', () => {
    for (const body of [null, undefined, 'nope', 7, ['a']]) {
      expect(validateSettingsRequest(body)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('validates path parameters as snowflakes', () => {
    expect(isSnowflakeParam('910000000000000001')).toBe(true);
    expect(isSnowflakeParam('1')).toBe(false);
    expect(isSnowflakeParam("910000000000000001' OR 1=1")).toBe(false);
    expect(isSnowflakeParam(undefined)).toBe(false);
  });
});
