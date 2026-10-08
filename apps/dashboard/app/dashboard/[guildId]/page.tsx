import { GuildPageDenied, loadGuildPage } from '../../../lib/guildPage';
import { StatCard } from '../../../components/StatCard';
import { Sparkline } from '../../../components/Sparkline';

export const dynamic = 'force-dynamic';

export default async function GuildOverviewPage({
  params,
}: {
  params: { guildId: string };
}): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId).catch((error) => {
    if (error instanceof GuildPageDenied) return null;
    throw error;
  });

  if (!context) {
    return <div className="empty">Access to this server was denied.</div>;
  }

  const [overview, series, topLevels] = await Promise.all([
    context.repos.overview.forGuild(context.guildId),
    context.repos.overview.securityEventSeries(context.guildId, 14),
    context.repos.overview.topLevels(context.guildId, 5),
  ]);

  if (!overview) {
    return (
      <div className="empty">
        This bot has not recorded any data for this server yet. Invite the bot, then interact with
        it once.
      </div>
    );
  }

  return (
    <div>
      <div className="grid">
        <StatCard label="Members (last seen)" value={overview.memberCount ?? 'unknown'} />
        <StatCard label="Moderation cases" value={overview.moderationCases} />
        <StatCard label="Warnings" value={overview.warnings} />
        <StatCard label="Security events" value={overview.securityEvents} />
        <StatCard label="Open tickets" value={overview.openTickets} />
        <StatCard label="Active giveaways" value={overview.activeGiveaways} />
        <StatCard label="Custom commands" value={overview.guildCommands} />
        <StatCard label="Ranked members" value={overview.rankedMembers} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Security events (last 14 days)</h2>
        <Sparkline points={series} label="Events per day" />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Top levels</h2>
        {topLevels.length === 0 ? (
          <div className="empty">No XP recorded yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Level</th>
                <th>XP</th>
              </tr>
            </thead>
            <tbody>
              {topLevels.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <code>{row.userId}</code>
                  </td>
                  <td>{row.level}</td>
                  <td>{row.xp.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
