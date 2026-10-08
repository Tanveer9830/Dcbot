import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function AutoModPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.automod ?? {}) as Record<string, unknown>;
  const read = <T,>(key: string, fallback: T): T => (config[key] === undefined ? fallback : (config[key] as T));

  return (
    <div>
      <h2>AutoMod</h2>
      <p className="muted">
        Discord delivers a message before the bot can see it, so &quot;blocking&quot; means deleting the message
        immediately and acting on the author. It cannot unsend what already reached clients.
      </p>
      <SettingsForm
        guildId={context.guildId}
        group="automod"
        fields={[
          { key: 'enabled', label: 'AutoMod enabled', type: 'boolean', value: read('enabled', false) },
          { key: 'blockInvites', label: 'Block invite links', type: 'boolean', value: read('blockInvites', true) },
          { key: 'blockLinks', label: 'Block suspicious links', type: 'boolean', value: read('blockLinks', false) },
          { key: 'blockMentions', label: 'Block mass mentions', type: 'boolean', value: read('blockMentions', false) },
          {
            key: 'mentionThreshold',
            label: 'Mention threshold',
            type: 'number',
            value: read('mentionThreshold', 10),
            min: 1,
            max: 100,
          },
          { key: 'blockCaps', label: 'Block excessive caps', type: 'boolean', value: read('blockCaps', false) },
          {
            key: 'capsRatio',
            label: 'Caps ratio (0.1-1)',
            type: 'number',
            value: read('capsRatio', 0.7),
            min: 0.1,
            max: 1,
          },
          { key: 'blockRepeated', label: 'Block repeated messages', type: 'boolean', value: read('blockRepeated', false) },
          {
            key: 'blockedWords',
            label: 'Blocked words',
            type: 'list',
            value: read<string[]>('blockedWords', []),
            help: 'Comma separated. Matching is case-insensitive.',
          },
          {
            key: 'exemptRoleIds',
            label: 'Exempt role IDs',
            type: 'list',
            value: read<string[]>('exemptRoleIds', []),
          },
          {
            key: 'exemptChannelIds',
            label: 'Exempt channel IDs',
            type: 'list',
            value: read<string[]>('exemptChannelIds', []),
          },
          {
            key: 'action',
            label: 'Action on trigger',
            type: 'select',
            value: read('action', 'log'),
            options: [
              { value: 'log', label: 'Log only' },
              { value: 'delete', label: 'Delete message' },
              { value: 'warn', label: 'Warn author' },
              { value: 'timeout', label: 'Timeout author (5m)' },
            ],
          },
        ]}
      />
    </div>
  );
}
