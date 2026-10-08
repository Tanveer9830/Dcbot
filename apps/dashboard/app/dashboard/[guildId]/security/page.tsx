import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';
import { StatCard } from '../../../../components/StatCard';

export const dynamic = 'force-dynamic';

export default async function SecurityPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const [settings, events, trustedUsers, trustedRoles] = await Promise.all([
    context.repos.security.getSettings(context.guildId),
    context.repos.security.recentEvents(context.guildId, 20),
    context.repos.security.trustedUserIds(context.guildId),
    context.repos.security.trustedRoleIds(context.guildId),
  ]);

  return (
    <div>
      <h2>Security</h2>
      <div className="grid">
        <StatCard label="Anti-nuke" value={settings.antiNukeEnabled ? 'enabled' : 'disabled'} />
        <StatCard label="Anti-raid" value={settings.antiRaidEnabled ? 'enabled' : 'disabled'} />
        <StatCard label="Anti-spam" value={settings.antiSpamEnabled ? 'enabled' : 'disabled'} />
        <StatCard
          label="Thresholds"
          value={`${settings.joinThreshold} joins / ${Math.round(settings.joinWindowMs / 1000)}s`}
          detail={`${settings.spamThreshold} messages / ${Math.round(settings.spamWindowMs / 1000)}s`}
        />
        <StatCard label="Trusted users" value={trustedUsers.length} />
        <StatCard label="Trusted roles" value={trustedRoles.length} />
      </div>

      <h3 style={{ marginTop: 20 }}>Configuration</h3>
      <SettingsForm
        guildId={context.guildId}
        group="security"
        fields={[
          { key: 'antiNukeEnabled', label: 'Anti-nuke', type: 'boolean', value: settings.antiNukeEnabled },
          { key: 'antiRaidEnabled', label: 'Anti-raid', type: 'boolean', value: settings.antiRaidEnabled },
          { key: 'antiSpamEnabled', label: 'Anti-spam', type: 'boolean', value: settings.antiSpamEnabled },
          { key: 'lockdownOnTrigger', label: 'Auto-lockdown on trigger', type: 'boolean', value: settings.lockdownOnTrigger },
          { key: 'joinThreshold', label: 'Join threshold', type: 'number', value: settings.joinThreshold, min: 1, max: 100 },
          { key: 'joinWindowMs', label: 'Join window (ms)', type: 'number', value: settings.joinWindowMs, min: 1000, max: 300000 },
          { key: 'spamThreshold', label: 'Message threshold', type: 'number', value: settings.spamThreshold, min: 2, max: 50 },
          { key: 'spamWindowMs', label: 'Message window (ms)', type: 'number', value: settings.spamWindowMs, min: 1000, max: 120000 },
          { key: 'mentionThreshold', label: 'Mention threshold', type: 'number', value: settings.mentionThreshold, min: 1, max: 100 },
          { key: 'minAccountAgeDays', label: 'Minimum account age (days)', type: 'number', value: settings.minAccountAgeDays, min: 0, max: 365 },
          { key: 'alertChannelId', label: 'Alert channel ID', type: 'text', value: settings.alertChannelId ?? '' },
        ]}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Trusted users and roles are managed with <code>/security trust</code> in Discord; that path records who granted
        the exemption.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent security events</h3>
        {events.length === 0 ? (
          <div className="empty">No security events recorded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Actor</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{event.type}</td>
                  <td>
                    <span className={`pill ${event.severity === 'critical' || event.severity === 'high' ? 'pill-bad' : 'pill-warn'}`}>
                      {event.severity}
                    </span>
                  </td>
                  <td>{event.actorId ? <code>{event.actorId.slice(0, 8)}…</code> : 'unknown'}</td>
                  <td>{event.actionTaken ?? 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
