import { loadGuildPage } from '../../../../lib/guildPage';

export const dynamic = 'force-dynamic';

export default async function CommandsPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const guildCommands = await context.repos.customCommands.listGuild(context.guildId);
  // Global commands are listed (names only) so admins can see what exists, but
  // creating or editing them is owner-only and only possible in Discord.
  const globalCommands = await context.repos.customCommands.listGlobal();

  return (
    <div>
      <h2>Custom commands</h2>

      <div className="card">
        <h3>This server ({guildCommands.length})</h3>
        {guildCommands.length === 0 ? (
          <div className="empty">
            No server commands yet. Create one in Discord with <code>/config</code> or the guild command tools.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {guildCommands.map((command) => (
                <tr key={command.id}>
                  <td>
                    <code>{command.name}</code>
                  </td>
                  <td>{command.description}</td>
                  <td>{command.responseType}</td>
                  <td>{command.enabled ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Global commands ({globalCommands.length})</h3>
        <div className="alert" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          Global commands are managed exclusively by the configured bot owners through <code>/globalcommand</code> in
          Discord. Server administrators cannot create, edit, publish or delete them - including through this
          dashboard, which has no write path for them.
        </div>
        {globalCommands.length === 0 ? (
          <div className="empty">No global commands published.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {globalCommands.map((command) => (
                <tr key={command.id}>
                  <td>
                    <code>{command.name}</code>
                  </td>
                  <td>{command.description}</td>
                  <td>{command.enabled ? 'published' : 'disabled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
