import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  params,
}: {
  params: { guildId: string };
}): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.welcome ?? {}) as Record<string, unknown>;
  const read = <T,>(key: string, fallback: T): T =>
    config[key] === undefined ? fallback : (config[key] as T);

  return (
    <div>
      <h2>Welcome and leave messages</h2>
      <p className="muted">
        Available template variables: <code>{'{{user}}'}</code>, <code>{'{{user.id}}'}</code>,{' '}
        <code>{'{{guild}}'}</code>, <code>{'{{member_count}}'}</code>, <code>{'{{date}}'}</code>.
        Unknown variables render as empty text; templates are never evaluated as code.
      </p>
      <SettingsForm
        guildId={context.guildId}
        group="welcome"
        fields={[
          {
            key: 'enabled',
            label: 'Welcome messages',
            type: 'boolean',
            value: read('enabled', false),
          },
          {
            key: 'channelId',
            label: 'Welcome channel ID',
            type: 'text',
            value: read('channelId', ''),
          },
          {
            key: 'message',
            label: 'Welcome message',
            type: 'textarea',
            value: read(
              'message',
              'Welcome {{user}} to **{{guild}}**! You are member #{{member_count}}.',
            ),
          },
          {
            key: 'leaveEnabled',
            label: 'Leave messages',
            type: 'boolean',
            value: read('leaveEnabled', false),
          },
          {
            key: 'leaveMessage',
            label: 'Leave message',
            type: 'textarea',
            value: read('leaveMessage', '{{user}} has left.'),
          },
          {
            key: 'autoRoleIds',
            label: 'Auto-role IDs',
            type: 'list',
            value: read<string[]>('autoRoleIds', []),
          },
          {
            key: 'dmOnJoin',
            label: 'Also DM the member',
            type: 'boolean',
            value: read('dmOnJoin', false),
          },
          {
            key: 'verificationRoleId',
            label: 'Verification role ID',
            type: 'text',
            value: read('verificationRoleId', ''),
          },
        ]}
      />
    </div>
  );
}
