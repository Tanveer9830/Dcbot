import { PERMISSION_BIT, type PermissionBit } from './constants.js';

/**
 * Permission helpers that operate on plain bigint bitfields.
 *
 * They deliberately do not import discord.js so that access-control decisions
 * can be unit tested without booting a Discord client or touching the network.
 */

export function hasPermission(
  bitfield: bigint | null | undefined,
  permission: PermissionBit,
): boolean {
  if (bitfield === null || bitfield === undefined) return false;
  if ((bitfield & PERMISSION_BIT.ADMINISTRATOR) === PERMISSION_BIT.ADMINISTRATOR) return true;
  return (bitfield & permission) === permission;
}

export function hasAll(
  bitfield: bigint | null | undefined,
  permissions: readonly PermissionBit[],
): boolean {
  return permissions.every((permission) => hasPermission(bitfield, permission));
}

export function hasAny(
  bitfield: bigint | null | undefined,
  permissions: readonly PermissionBit[],
): boolean {
  return permissions.some((permission) => hasPermission(bitfield, permission));
}

/** Permissions missing from `bitfield` out of the requested set. */
export function missingPermissions(
  bitfield: bigint | null | undefined,
  permissions: readonly PermissionBit[],
): PermissionBit[] {
  return permissions.filter((permission) => !hasPermission(bitfield, permission));
}

/**
 * Discord's role hierarchy rule: the bot cannot moderate a member whose highest
 * role sits at or above the bot's own highest role, and it cannot moderate the
 * guild owner. This mirrors that rule so callers can refuse *before* Discord
 * returns a 50013.
 */
export function canModerateTarget(params: {
  targetIsGuildOwner: boolean;
  actorHighestRolePosition: number;
  targetHighestRolePosition: number;
  botHighestRolePosition: number;
  targetHighestRolePositionForBot?: number;
}): boolean {
  if (params.targetIsGuildOwner) return false; // The guild owner cannot be moderated.
  if (params.targetHighestRolePosition >= params.actorHighestRolePosition) return false;
  const botHighest = params.botHighestRolePosition;
  const targetForBot = params.targetHighestRolePositionForBot ?? params.targetHighestRolePosition;
  return targetForBot < botHighest;
}

/**
 * Determines whether a user may run a staff-level action in a guild.
 * Server administrators are allowed, plus explicitly configured staff roles.
 * This is intentionally separate from bot-owner authorization.
 */
export function isGuildStaff(params: {
  permissions: bigint | null | undefined;
  roleIds: readonly string[];
  staffRoleIds: readonly string[];
  trustedUserIds: readonly string[];
  userId: string;
}): boolean {
  if (hasAny(params.permissions, [PERMISSION_BIT.MANAGE_GUILD, PERMISSION_BIT.BAN_MEMBERS])) {
    return true;
  }
  if (params.staffRoleIds.some((role) => params.roleIds.includes(role))) return true;
  return params.trustedUserIds.includes(params.userId);
}

export { PERMISSION_BIT };
export type { PermissionBit };
