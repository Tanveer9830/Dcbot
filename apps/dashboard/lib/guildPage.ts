import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from './session';
import { AuthorizationFailure, assertGuildManager, isOwner } from './authorization';
import { getRepos, type Repos } from './db';
import type { GuildSettingsRow } from '@dcbot/database';

export interface GuildPageContext {
  session: SessionPayload;
  repos: Repos;
  guildId: string;
  guildName: string;
  settings: GuildSettingsRow;
  isOwner: boolean;
}

export class GuildPageDenied extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GuildPageDenied';
  }
}

/**
 * Shared loader for every /dashboard/[guildId] page.
 *
 * Redirects to /login when there is no session, throws GuildPageDenied(403)
 * when the user cannot manage the guild, and 503 when the database is down.
 */
export async function loadGuildPage(guildId: string): Promise<GuildPageContext> {
  const session = await getSession();
  if (!session) redirect('/login');

  const repos = getRepos();
  if (!repos) throw new GuildPageDenied('The dashboard has no database connection.', 503);

  try {
    const guild = await assertGuildManager({ session, token: session.accessToken, guildId });
    const settings = await repos.guilds.getSettings(guildId);
    return {
      session,
      repos,
      guildId,
      guildName: guild.name,
      settings,
      isOwner: isOwner(session),
    };
  } catch (error) {
    if (error instanceof AuthorizationFailure) throw new GuildPageDenied(error.message, 403);
    throw error;
  }
}
