import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function ModerationPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.moderation ?? {}) as {
    dmOnAction?: boolean;
    logChannelId?: string | null;
    escalation?: Array<{ warnings: number; action: string }>;
    appealChannelId?: string | null;
    defaultTimeoutMinutes?: number;
  };
  const recent = await context.repos.audit.list({ guildId: context.guildId, limit: 15 });

  return (
    <div>
      <h2>Moderation</h2>
      <p className="muted">
        These settings change how the bot records and escalates actions. Destructive actions always validate role
        hierarchy before contacting Discord.
      </p>
      <SettingsForm
        guildId={context.guildId}
        group="moderation"
        fields={[
          { key: 'dmOnAction', label: 'DM the member on action', type: 'boolean', value: config.dmOnAction ?? true },
          {
            key: 'logChannelId',
            label: 'Moderation log channel ID',
            type: 'text',
            value: config.logChannelId ?? '',
            help: 'Snowflake of the channel. Leave empty to disable.',
          },
          {
            key: 'defaultTimeoutMinutes',
            label: 'Default timeout length (minutes)',
            type: 'number',
            value: config.defaultTimeoutMinutes ?? 10,
            min: 1,
            max: 40320,
          },
          {
            key: 'appealChannelId',
            label: 'Appeal channel ID',
            type: 'text',
            value: config.appealChannelId ?? '',
            help: 'Posted in moderation DMs so members know where to appeal.',
          },
        ]}
      />

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent audit entries</h3>
        {recent.length === 0 ? (
          <div className="empty">No audit entries recorded yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <code>{entry.actorId.slice(0, 8)}…</code>
                  </td>
                  <td>{entry.action}</td>
                  <td>{entry.targetId || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="alert" style={{ marginTop: 16, borderColor: 'var(--border)', color: 'var(--muted)' }}>
        Escalation rules ({config.escalation?.length ?? 0} configured) are managed with <code>/security</code> and
        <code>/warn</code> in Discord so staff changes stay in the same audit trail.
      </div>
    </div>
  );
}
