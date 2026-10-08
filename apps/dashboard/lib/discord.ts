const API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** Decimal permission bitfield as a string. */
  permissions: string;
  features: string[];
}

export interface DiscordMember {
  user?: DiscordUser;
  roles: string[];
  permissions?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class DiscordApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(`Discord API ${path} -> ${response.status}: ${body.slice(0, 200)}`, response.status);
  }
  return (await response.json()) as T;
}

export function currentUser(token: string): Promise<DiscordUser> {
  return request<DiscordUser>('/users/@me', token);
}

/**
 * Guilds the signed-in user can see.
 *
 * The dashboard filters this list again with `canManageGuild` - the raw list
 * includes servers the user merely belongs to.
 */
export function currentUserGuilds(token: string): Promise<DiscordGuild[]> {
  return request<DiscordGuild[]>('/users/@me/guilds', token);
}

export function guildMember(token: string, guildId: string, userId: string): Promise<DiscordMember> {
  return request<DiscordMember>(`/guilds/${guildId}/members/${userId}`, token);
}

export function avatarUrl(user: DiscordUser | { id: string; avatar: string | null }, size = 128): string {
  if (!user.avatar) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) % 6n)}.png`;
  }
  const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
}

export function iconUrl(guild: { id: string; icon: string | null }): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}
