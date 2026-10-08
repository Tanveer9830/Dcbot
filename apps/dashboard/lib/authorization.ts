import { OwnerPolicy } from '@dcbot/shared';
import { PERMISSION_BIT, hasAll } from '@dcbot/shared';
import { currentUserGuilds, guildMember, type DiscordGuild } from './discord';
import { getSession, type SessionPayload } from './session';

/**
 * Server-side authorization.
 *
 * These functions are the ONLY thing that decides whether a dashboard request
 * is allowed. Hiding a button in the UI is cosmetic; every mutation route calls
 * one of these first, and the guild ID always comes from the server-verified
 * Discord API, never from a client-supplied permission value.
 */

export function ownerPolicy(): OwnerPolicy {
  return new OwnerPolicy({ raw: process.env.BOT_OWNER_IDS, strict: false });
}

export function isOwner(session: SessionPayload | null): boolean {
  return ownerPolicy().isOwner(session?.userId ?? null);
}

/** MANAGE_GUILD or ADMINISTRATOR on the guild, per Discord's own bitfield. */
export function canManageGuildPermissions(permissions: string | bigint | undefined): boolean {
  if (permissions === undefined || permissions === null) return false;
  const bits = typeof permissions === 'bigint' ? permissions : BigInt(permissions || '0');
  return hasAll(bits, [PERMISSION_BIT.MANAGE_GUILD]);
}

export interface ManagedGuildsResult {
  guilds: DiscordGuild[];
  manageable: DiscordGuild[];
}

/**
 * Returns the guilds the user may manage.
 * Ownership counts as management; otherwise MANAGE_GUILD is required.
 */
export async function managedGuilds(token: string): Promise<ManagedGuildsResult> {
  const guilds = await currentUserGuilds(token);
  const manageable = guilds.filter(
    (guild) => guild.owner || canManageGuildPermissions(guild.permissions),
  );
  return { guilds, manageable };
}

/**
 * Verifies that the signed-in user may administer `guildId`.
 *
 * Throws a 403-shaped error when not. The guild ID is confirmed against
 * Discord's list for this user, so a forged guild ID cannot pass.
 */
export async function assertGuildManager(params: {
  session: SessionPayload;
  token: string;
  guildId: string;
}): Promise<DiscordGuild> {
  if (isOwner(params.session)) {
    // Owners still need the guild to exist in their list before we can act on
    // it, but they are not required to hold MANAGE_GUILD.
    const guilds = await currentUserGuilds(params.token);
    const guild = guilds.find((entry) => entry.id === params.guildId);
    if (!guild) throw new AuthorizationFailure('That server is not visible to your account.');
    return guild;
  }

  const { manageable } = await managedGuilds(params.token);
  const guild = manageable.find((entry) => entry.id === params.guildId);
  if (!guild) {
    throw new AuthorizationFailure('You need Manage Server permission in that server.');
  }

  // Cross-check membership roles server-side; the guild list can be stale.
  try {
    const member = await guildMember(params.token, params.guildId, params.session.userId);
    if (!member) throw new AuthorizationFailure('You are not a member of that server.');
  } catch (error) {
    if (error instanceof AuthorizationFailure) throw error;
    // A failed lookup (e.g. bot not in guild) must not silently grant access.
    throw new AuthorizationFailure('Could not verify your membership in that server.');
  }
  return guild;
}

export class AuthorizationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationFailure';
  }
}

/** Convenience: returns the session or null (used by server components). */
export async function requireSession(): Promise<SessionPayload | null> {
  return getSession();
}
