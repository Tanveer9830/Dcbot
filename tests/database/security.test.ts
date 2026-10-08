import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecurityRepository } from '@dcbot/database';
import { createTestDatabase, USES_REAL_POSTGRES, type TestDatabase } from '../helpers/db.js';

const MOD = '940000000000000001';
const USER = '940000000000000002';

let db: TestDatabase;
let security: SecurityRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  security = new SecurityRepository(db);
});
afterAll(async () => {
  await db.close();
});

describe('security repository', () => {
  it('returns the safe defaults for a guild that has no row yet', async () => {
    const settings = await security.getSettings('940000000000000003');
    expect(settings.antiNukeEnabled).toBe(true);
    expect(settings.antiRaidEnabled).toBe(true);
    expect(settings.joinThreshold).toBeGreaterThan(0);
    expect(settings.configHistory).toEqual([]);
  });

  // config_history is appended with JSONB concatenation, which pg-mem does not
  // implement. Runs against the PostgreSQL service in CI.
  it.runIf(USES_REAL_POSTGRES)('records who changed security settings and when', async () => {
    const guild = '940000000000000004';
    await security.updateSettings(guild, { joinThreshold: 9, updatedBy: MOD });
    await security.updateSettings(guild, { joinThreshold: 12, updatedBy: MOD });

    const settings = await security.getSettings(guild);
    expect(settings.joinThreshold).toBe(12);
    expect(settings.updatedBy).toBe(MOD);
    expect(settings.configHistory).toHaveLength(2);
  });

  it('tracks trusted users and roles, and resolves them together', async () => {
    const guild = '940000000000000005';
    await security.addTrustedUser(guild, USER, MOD, 'co-owner');
    await security.addTrustedRole(guild, '940000000000000006', MOD);

    expect(await security.trustedUserIds(guild)).toContain(USER);
    expect(await security.trustedRoleIds(guild)).toContain('940000000000000006');
    expect(await security.isTrusted(guild, USER, [])).toBe(true);
    expect(await security.isTrusted(guild, '940000000000000099', ['940000000000000006'])).toBe(
      true,
    );
    expect(await security.isTrusted(guild, '940000000000000099', ['940000000000000098'])).toBe(
      false,
    );

    expect(await security.removeTrustedUser(guild, USER)).toBe(true);
    expect(await security.removeTrustedUser(guild, USER)).toBe(false);
    expect(await security.isTrusted(guild, USER, [])).toBe(false);
  });

  it('stores security events with detail and can filter by type', async () => {
    const guild = '940000000000000007';
    await security.recordEvent({
      guildId: guild,
      type: 'anti_nuke',
      severity: 'critical',
      actorId: MOD,
      detail: { channelDeletes: 4, threshold: 3 },
      actionTaken: 'role_stripped',
    });
    await security.recordEvent({
      guildId: guild,
      type: 'anti_spam',
      severity: 'low',
      actorId: USER,
    });

    const all = await security.recentEvents(guild, 10);
    expect(all).toHaveLength(2);
    const nuke = await security.recentEvents(guild, 10, 'anti_nuke');
    expect(nuke).toHaveLength(1);
    expect(nuke[0]?.detail).toMatchObject({ channelDeletes: 4 });
    expect(nuke[0]?.actionTaken).toBe('role_stripped');
    expect(nuke[0]?.severity).toBe('critical');

    expect(await security.countEventsSince(guild, 'anti_nuke', new Date(Date.now() - 60_000))).toBe(
      1,
    );
    expect(await security.countEventsSince(guild, 'anti_nuke', new Date(Date.now() + 60_000))).toBe(
      0,
    );
  });

  it('protects users from being tagged and counts violations per offender', async () => {
    const guild = '940000000000000008';
    const offender = '940000000000000009';

    await security.protectUser({
      guildId: guild,
      userId: USER,
      mode: 'delete',
      setBy: USER,
      selfSelected: true,
    });
    const protection = await security.isProtected(guild, USER);
    expect(protection.protected).toBe(true);
    expect(protection.mode).toBe('delete');

    await security.recordNoTagViolation({
      guildId: guild,
      channelId: '940000000000000010',
      messageId: '940000000000000011',
      protectedUserId: USER,
      offenderId: offender,
      actionTaken: 'deleted',
    });
    await security.recordNoTagViolation({
      guildId: guild,
      channelId: '940000000000000010',
      messageId: null,
      protectedUserId: USER,
      offenderId: offender,
      actionTaken: 'warned',
    });

    const violations = await security.noTagViolations(guild, 10);
    expect(violations).toHaveLength(2);
    expect(
      await security.violationsByOffender(guild, offender, new Date(Date.now() - 60_000)),
    ).toBe(2);

    // Mode changes overwrite instead of duplicating the row.
    await security.protectUser({ guildId: guild, userId: USER, mode: 'timeout', setBy: MOD });
    expect(
      (await security.protectedUsers(guild)).filter((row) => row.userId === USER),
    ).toHaveLength(1);

    expect(await security.unprotectUser(guild, USER)).toBe(true);
    expect((await security.isProtected(guild, USER)).protected).toBe(false);
  });

  it('records pin events and reports an unknown actor when attribution is impossible', async () => {
    const guild = '940000000000000012';
    await security.recordPinEvent({
      guildId: guild,
      channelId: '940000000000000013',
      pinned: true,
      actorId: USER,
      actorSource: 'audit_log',
      actionTaken: 'unpinned',
    });
    await security.recordPinEvent({
      guildId: guild,
      channelId: '940000000000000014',
      pinned: false,
    });

    const events = await security.pinEvents(guild, 10);
    expect(events).toHaveLength(2);
    const unattributed = events.find((event) => event.channelId === '940000000000000014');
    expect(unattributed?.actorSource).toBe('unknown');
    expect(unattributed?.actorId).toBeNull();

    const filtered = await security.pinEvents(guild, 10, '940000000000000013');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.actorSource).toBe('audit_log');
  });

  it('prunes rows outside the retention window and leaves newer ones alone', async () => {
    const guild = '940000000000000015';
    await security.recordEvent({ guildId: guild, type: 'anti_spam', severity: 'low' });
    await db.query(
      "INSERT INTO security_events (guild_id, type, severity, created_at) VALUES ($1, $2, $3, now() - INTERVAL '200 days')",
      [guild, 'anti_spam', 'low'],
    );

    const pruned = await security.pruneOldRows(90);
    expect(pruned.securityEvents).toBe(1);
    expect(await security.recentEvents(guild, 10)).toHaveLength(1);
  });
});
