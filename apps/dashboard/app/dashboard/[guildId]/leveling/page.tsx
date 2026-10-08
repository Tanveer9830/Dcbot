import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function LevelingPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.leveling ?? {}) as Record<string, unknown>;
  const read = <T,>(key: string, fallback: T): T => (config[key] === undefined ? fallback : (config[key] as T));
  const leaderboard = await context.repos.overview.topLevels(context.guildId, 10);

  return (
    <div>
      <h2>Leveling</h2>
      <SettingsForm
        guildId={context.guildId}
        group="leveling"
        fields={[
          { key: 'enabled', label: 'Leveling enabled', type: 'boolean', value: read('enabled', true) },
          { key: 'xpMin', label: 'Minimum XP per message', type: 'number', value: read('xpMin', 15), min: 0, max: 500 },
          { key: 'xpMax', label: 'Maximum XP per message', type: 'number', value: read('xpMax', 25), min: 0, max: 1000 },
          { key: 'cooldownSeconds', label: 'XP cooldown (seconds)', type: 'number', value: read('cooldownSeconds', 60), min: 5, max: 3600 },
          { key: 'multiplier', label: 'XP multiplier', type: 'number', value: read('multiplier', 1), min: 0.1, max: 10 },
          { key: 'announceLevelUp', label: 'Announce level ups', type: 'boolean', value: read('announceLevelUp', true) },
          { key: 'announceChannelId', label: 'Announcement channel ID', type: 'text', value: read('announceChannelId', '') },
          { key: 'exemptChannelIds', label: 'XP-exempt channel IDs', type: 'list', value: read<string[]>('exemptChannelIds', []) },
        ]}
      />
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Leaderboard</h3>
        {leaderboard.length === 0 ? (
          <div className="empty">No XP recorded yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Level</th>
                <th>XP</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, index) => (
                <tr key={row.userId}>
                  <td>{index + 1}</td>
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
