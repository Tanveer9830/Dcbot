import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, publicSession } from '../../lib/session';
import { isOwner, managedGuilds } from '../../lib/authorization';
import { avatarUrl, iconUrl } from '../../lib/discord';
import { getRepos } from '../../lib/db';
import { configProblems } from '../../lib/env';

export const dynamic = 'force-dynamic';

export default async function DashboardIndex(): Promise<JSX.Element> {
  const session = await getSession();
  if (!session) redirect('/login');

  const problems = configProblems();
  const owner = isOwner(session);
  const me = publicSession(session);

  let manageable: Awaited<ReturnType<typeof managedGuilds>>['manageable'] = [];
  let discordError: string | null = null;
  try {
    const result = await managedGuilds(session.accessToken);
    manageable = result.manageable;
  } catch (error) {
    discordError = error instanceof Error ? error.message : 'Could not reach Discord.';
  }

  // Real bot-side data where it exists; no invented numbers.
  const repos = getRepos();
  const known = new Map<string, { moderationCases: number; openTickets: number; securityEvents: number }>();
  if (repos) {
    for (const guild of manageable) {
      const overview = await repos.overview.forGuild(guild.id).catch(() => null);
      if (overview) {
        known.set(guild.id, {
          moderationCases: overview.moderationCases,
          openTickets: overview.openTickets,
          securityEvents: overview.securityEvents,
        });
      }
    }
  }

  return (
    <div className="container" style={{ paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div className="row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl({ id: me.userId, avatar: me.avatar })} alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
          <div>
            <h1 style={{ marginBottom: 0 }}>{me.globalName ?? me.username}</h1>
            <div className="muted">
              {manageable.length} server{manageable.length === 1 ? '' : 's'} you can manage
              {owner ? ' · bot owner' : ''}
            </div>
          </div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </div>

      {owner ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <Link className="btn btn-primary" href="/owner">
            Open owner panel
          </Link>
        </div>
      ) : null}

      {problems.missing.length > 0 ? (
        <div className="alert">
          This instance is missing configuration: <code>{problems.missing.join(', ')}</code>. Settings cannot be read or
          saved until these are set.
        </div>
      ) : null}
      {discordError ? (
        <div className="alert alert-error">Could not load your servers from Discord: {discordError}</div>
      ) : null}
      {!repos ? <div className="alert">No database connection - stored settings cannot be shown or saved.</div> : null}

      {manageable.length === 0 && !discordError ? (
        <div className="empty">
          You do not manage any servers that this dashboard can see. You need <strong>Manage Server</strong> permission,
          or the bot must be invited to the server.
        </div>
      ) : null}

      <div className="grid">
        {manageable.map((guild) => {
          const stats = known.get(guild.id);
          return (
            <Link className="card" href={`/dashboard/${guild.id}`} key={guild.id} style={{ color: 'inherit' }}>
              <div className="row">
                {iconUrl(guild) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl(guild)!} alt="" width={40} height={40} style={{ borderRadius: 8 }} />
                ) : (
                  <span className="brand-dot" style={{ width: 40, height: 40, borderRadius: 8 }} />
                )}
                <div>
                  <h3 style={{ marginBottom: 2 }}>{guild.name}</h3>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    {guild.owner ? 'Owner' : 'Manage Server'}
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="pill">{stats ? `${stats.moderationCases} cases` : 'bot data unavailable'}</span>
                <span className="pill">{stats ? `${stats.openTickets} open tickets` : ''}</span>
                {stats && stats.securityEvents > 0 ? (
                  <span className="pill pill-warn">{stats.securityEvents} security events</span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
