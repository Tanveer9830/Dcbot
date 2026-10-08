import { redirect } from 'next/navigation';
import { getSession, publicSession } from '../../lib/session';
import { isOwner, ownerPolicy } from '../../lib/authorization';
import { dbHealth, getRepos } from '../../lib/db';
import { fetchBotMetrics, formatUptime } from '../../lib/botApi';
import { StatCard } from '../../components/StatCard';

export const dynamic = 'force-dynamic';

/**
 * Owner panel.
 *
 * Access is decided here on the server: only IDs present in BOT_OWNER_IDS pass.
 * No secret values are rendered - connectivity is reported as status and latency
 * only.
 */
export default async function OwnerPage(): Promise<JSX.Element> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isOwner(session)) {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <div className="card">
          <h1>Owner panel</h1>
          <div className="alert alert-error">
            This area is restricted to the configured bot owners. Your Discord ID is not in BOT_OWNER_IDS.
          </div>
          <a className="btn" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const repos = getRepos();
  const [health, stats, recentAudit, globalCommands, bot] = await Promise.all([
    dbHealth(),
    repos ? repos.overview.globalStats() : null,
    repos ? repos.audit.list({ limit: 25 }) : Promise.resolve([]),
    repos ? repos.customCommands.listGlobal() : Promise.resolve([]),
    fetchBotMetrics(),
  ]);

  const me = publicSession(session);
  const policy = ownerPolicy();

  return (
    <div className="container" style={{ paddingTop: 24 }}>
      <h1>Owner panel</h1>
      <p className="muted">
        Signed in as {me.globalName ?? me.username} (<code>{me.userId}</code>). Configured owners:{' '}
        {policy.count > 0 ? policy.listMasked().join(', ') : 'none'}
      </p>

      <div className="grid">
        <StatCard
          label="Database"
          value={health.ok ? 'connected' : 'unavailable'}
          detail={health.ok ? `${health.latencyMs} ms` : (health.error ?? 'unreachable')}
        />
        <StatCard label="Guilds tracked" value={stats?.guilds ?? 'n/a'} />
        <StatCard label="Custom commands" value={stats?.commands ?? 'n/a'} detail="enabled, all scopes" />
        <StatCard label="Security events" value={stats?.securityEvents ?? 'n/a'} detail="all guilds, all time" />
        <StatCard label="Global commands" value={globalCommands.length} detail="owner managed" />
        <StatCard label="Audit entries" value={recentAudit.length} detail="25 most recent" />
      </div>

      <h2 style={{ marginTop: 24 }}>Live bot process</h2>
      {bot.available ? (
        <div className="grid">
          <StatCard
            label="Bot uptime"
            value={formatUptime(bot.metrics.process.uptimeMs)}
            detail={`pid ${bot.metrics.process.pid} on Node ${bot.metrics.process.node}`}
          />
          <StatCard
            label="Gateway"
            value={bot.metrics.gateway.pingMs === null ? 'unknown' : `${bot.metrics.gateway.pingMs} ms`}
            detail={`websocket ${bot.metrics.gateway.status}`}
          />
          <StatCard
            label="Guilds / cached users"
            value={`${bot.metrics.gateway.guilds} / ${bot.metrics.gateway.cachedUsers}`}
            detail="from the gateway cache"
          />
          <StatCard
            label="Memory (RSS)"
            value={bot.metrics.process.memory.rss}
            detail={`heap ${bot.metrics.process.memory.heapUsed} of ${bot.metrics.process.memory.heapTotal}`}
          />
          <StatCard
            label="CPU load (1 min)"
            value={String(bot.metrics.process.cpu.load1)}
            detail={`${bot.metrics.process.cpu.cores} cores`}
          />
          <StatCard
            label="Logged errors"
            value={String(bot.metrics.logs.error)}
            detail={`${bot.metrics.logs.warn} warnings since boot`}
          />
          <StatCard
            label="Security events (24h)"
            value={bot.metrics.security ? String(bot.metrics.security.last24h) : 'unavailable'}
            detail={
              bot.metrics.security
                ? `${bot.metrics.security.criticalLast24h} critical`
                : 'database not attached to the bot'
            }
          />
          {bot.metrics.services.map((service) => (
            <StatCard
              key={service.service}
              label={service.service}
              value={service.status}
              detail={service.latencyMs !== undefined && service.latencyMs !== null
                ? `${service.latencyMs} ms${service.detail ? ` - ${service.detail}` : ''}`
                : (service.detail ?? '')}
            />
          ))}
        </div>
      ) : (
        <div className="alert" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          Live bot process metrics are unavailable: {bot.reason}. Enable <code>BOT_API_ENABLED=true</code> with a
          shared <code>BOT_API_TOKEN</code> (and <code>BOT_API_URL</code> when the bot runs on another host) to show
          uptime, gateway latency, memory and service health here. Values are never estimated.
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent owner and dashboard actions</h2>
        {recentAudit.length === 0 ? (
          <div className="empty">Nothing recorded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Kind</th>
                <th>Action</th>
                <th>Guild</th>
              </tr>
            </thead>
            <tbody>
              {recentAudit.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                  <td>
                    <code>{entry.actorId.slice(0, 8)}…</code>
                  </td>
                  <td>{entry.targetType}</td>
                  <td>{entry.action}</td>
                  <td>{entry.guildId ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Global custom commands</h2>
        <p className="muted">
          Create, edit, publish and disable these in Discord with <code>/globalcommand</code>. The repository enforces
          the owner check on every write, so this page is read-only by design.
        </p>
        {globalCommands.length === 0 ? (
          <div className="empty">None published.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>State</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {globalCommands.map((command) => (
                <tr key={command.id}>
                  <td>
                    <code>{command.name}</code>
                  </td>
                  <td>{command.description}</td>
                  <td>{command.responseType}</td>
                  <td>{command.enabled ? 'published' : 'disabled'}</td>
                  <td>{command.updatedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
