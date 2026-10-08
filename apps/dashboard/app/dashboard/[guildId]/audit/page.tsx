import { loadGuildPage } from '../../../../lib/guildPage';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const entries = await context.repos.audit.list({ guildId: context.guildId, limit: 100 });

  return (
    <div>
      <h2>Audit log</h2>
      <p className="muted">
        Every privileged change made through the bot or this dashboard. Secrets are stripped before storage and IPs are
        stored only as SHA-256 hashes.
      </p>
      {entries.length === 0 ? (
        <div className="empty">Nothing recorded yet.</div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Source</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                  <td>
                    <code>{entry.actorId.slice(0, 8)}…</code>
                  </td>
                  <td>{entry.targetType}</td>
                  <td>{entry.action}</td>
                  <td>{entry.targetId || '-'}</td>
                  <td>
                    <code>{JSON.stringify(entry.detail).slice(0, 80)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
