import { describe, expect, it } from 'vitest';
import {
  canModerateTarget,
  hasAll,
  hasAny,
  hasPermission,
  isGuildStaff,
  missingPermissions,
  PERMISSION_BIT,
} from '@dcbot/shared';

describe('permission helpers', () => {
  it('treats Administrator as granting every permission', () => {
    const ban = PERMISSION_BIT.BAN_MEMBERS;
    expect(hasPermission(PERMISSION_BIT.ADMINISTRATOR, ban)).toBe(true);
    expect(hasPermission(ban, ban)).toBe(true);
    expect(hasPermission(PERMISSION_BIT.KICK_MEMBERS, ban)).toBe(false);
    expect(hasPermission(null, ban)).toBe(false);
    expect(hasPermission(undefined, ban)).toBe(false);
  });

  it('computes hasAll / hasAny / missingPermissions', () => {
    const bitfield = PERMISSION_BIT.BAN_MEMBERS | PERMISSION_BIT.KICK_MEMBERS;
    const ban = PERMISSION_BIT.BAN_MEMBERS;
    const kick = PERMISSION_BIT.KICK_MEMBERS;
    const manageGuild = PERMISSION_BIT.MANAGE_GUILD;
    const manageRoles = PERMISSION_BIT.MANAGE_ROLES;
    expect(hasAll(bitfield, [ban, kick])).toBe(true);
    expect(hasAll(bitfield, [ban, manageGuild])).toBe(false);
    expect(hasAny(bitfield, [manageGuild, kick])).toBe(true);
    expect(hasAny(bitfield, [manageGuild, manageRoles])).toBe(false);
    expect(missingPermissions(bitfield, [ban, manageGuild, manageRoles])).toEqual([manageGuild, manageRoles]);
  });

  it('enforces the role hierarchy the same way Discord does', () => {
    const base = {
      targetIsGuildOwner: false,
      actorHighestRolePosition: 10,
      targetHighestRolePosition: 5,
      botHighestRolePosition: 20,
    };
    expect(canModerateTarget(base)).toBe(true);
    expect(canModerateTarget({ ...base, targetIsGuildOwner: true })).toBe(false);
    expect(canModerateTarget({ ...base, targetHighestRolePosition: 10 })).toBe(false); // equal rank
    expect(canModerateTarget({ ...base, targetHighestRolePosition: 11 })).toBe(false); // above the actor
    expect(canModerateTarget({ ...base, botHighestRolePosition: 4 })).toBe(false); // above the bot
  });

  it('lets staff act through Administrator, a staff role, or the trusted list', () => {
    const roleIds = ['111'];
    expect(
      isGuildStaff({ permissions: PERMISSION_BIT.MANAGE_GUILD, roleIds: [], staffRoleIds: [], trustedUserIds: [], userId: 'u' }),
    ).toBe(true);
    expect(isGuildStaff({ permissions: 0n, roleIds, staffRoleIds: ['111'], trustedUserIds: [], userId: 'u' })).toBe(true);
    expect(
      isGuildStaff({ permissions: 0n, roleIds: ['999'], staffRoleIds: ['111'], trustedUserIds: ['u'], userId: 'u' }),
    ).toBe(true);
    expect(
      isGuildStaff({ permissions: 0n, roleIds: ['999'], staffRoleIds: ['111'], trustedUserIds: ['other'], userId: 'u' }),
    ).toBe(false);
  });
});
