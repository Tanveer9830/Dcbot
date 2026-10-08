import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

const EVENT_KEYS = [
  'message_delete',
  'message_edit',
  'member_join',
  'member_leave',
  'role_change',
  'moderation',
  'security',
  'ticket',
  'economy',
  'errors',
];

export default async function LoggingPage({
  params,
}: {
  params: { guildId: string };
}): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.logging ?? {}) as {
    enabled?: boolean;
    channels?: Record<string, string>;
    events?: Record<string, boolean>;
  };
  const channels = config.channels ?? {};
  const events = config.events ?? {};

  return (
    <div>
      <h2>Logging</h2>
      <div className="alert" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        Only events Discord actually exposes can be logged. Deleted message content is shown only
        when the message was still in cache - the bot never reconstructs history it did not see.
      </div>
      <SettingsForm
        guildId={context.guildId}
        group="logging"
        fields={[
          {
            key: 'enabled',
            label: 'Logging enabled',
            type: 'boolean',
            value: config.enabled ?? false,
          },
          {
            key: 'channels.moderation',
            label: 'Moderation channel ID',
            type: 'text',
            value: channels.moderation ?? '',
          },
          {
            key: 'channels.security',
            label: 'Security channel ID',
            type: 'text',
            value: channels.security ?? '',
          },
          {
            key: 'channels.messages',
            label: 'Message log channel ID',
            type: 'text',
            value: channels.messages ?? '',
          },
          {
            key: 'channels.members',
            label: 'Member log channel ID',
            type: 'text',
            value: channels.members ?? '',
          },
          {
            key: 'channels.tickets',
            label: 'Ticket log channel ID',
            type: 'text',
            value: channels.tickets ?? '',
          },
          {
            key: 'channels.errors',
            label: 'Error channel ID',
            type: 'text',
            value: channels.errors ?? '',
          },
          ...EVENT_KEYS.map((key) => ({
            key: `events.${key}`,
            label: `Log ${key.replace(/_/g, ' ')}`,
            type: 'boolean' as const,
            value: events[key] ?? true,
          })),
        ]}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Nested keys are written into the <code>logging</code> JSONB group; unknown keys are ignored
        by the bot.
      </p>
    </div>
  );
}
