import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuildRepository, SETTINGS_GROUPS, isSettingsGroup } from '@dcbot/database';
import { createTestDatabase, USES_REAL_POSTGRES, type TestDatabase } from '../helpers/db.js';

let db: TestDatabase;
let guilds: GuildRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  guilds = new GuildRepository(db);
});

afterAll(async () => {
  await db.close();
});

describe('guild settings', () => {
  it('exposes a fixed allowlist of settings groups', () => {
    expect(SETTINGS_GROUPS).toContain('moderation');
    expect(isSettingsGroup('moderation')).toBe(true);
    expect(isSettingsGroup('guild_id; DROP TABLE guilds')).toBe(false);
    expect(isSettingsGroup('passwords')).toBe(false);
  });

  // JSONB concatenation (`a || b`) is not implemented by pg-mem, so the merge is
  // only exercised against real PostgreSQL. It runs in CI's Postgres service.
  it.runIf(USES_REAL_POSTGRES)('merges a patch into a single group without touching the others', async () => {
    const guildId = '910000000000000001';
    await db.query('INSERT INTO guilds (guild_id, name) VALUES ($1, $2)', [guildId, 'Settings Guild']);

    await guilds.updateSettingsGroup(guildId, 'moderation', { logChannelId: '111', maxMentions: 5 });
    await guilds.updateSettingsGroup(guildId, 'moderation', { maxMentions: 8 });
    await guilds.updateSettingsGroup(guildId, 'welcome', { enabled: true });

    const settings = await guilds.getSettings(guildId);
    expect(settings.moderation).toMatchObject({ logChannelId: '111', maxMentions: 8 });
    expect(settings.welcome).toMatchObject({ enabled: true });
    expect(settings.security).toEqual({});
  });

  it('refuses an unknown group instead of interpolating it into SQL', async () => {
    await expect(
      guilds.updateSettingsGroup('910000000000000001', 'guild_settings' as never, { x: 1 }),
    ).rejects.toThrow(/Unknown settings group/);
  });

  it('creates a settings row on demand', async () => {
    const guildId = '910000000000000002';
    await db.query('INSERT INTO guilds (guild_id, name) VALUES ($1, $2)', [guildId, 'Lazy Guild']);
    const settings = await guilds.getSettings(guildId);
    expect(String(settings.guild_id)).toBe(guildId);
  });
});
