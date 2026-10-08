import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';
import { StatCard } from '../../../../components/StatCard';

export const dynamic = 'force-dynamic';

export default async function TicketsPage({
  params,
}: {
  params: { guildId: string };
}): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.tickets ?? {}) as Record<string, unknown>;
  const read = <T,>(key: string, fallback: T): T =>
    config[key] === undefined ? fallback : (config[key] as T);
  const [open, claimed, closed] = await Promise.all([
    context.repos.audit.list({
      guildId: context.guildId,
      action: 'dashboard.settings.tickets',
      limit: 1,
    }),
    context.repos.audit.list({ guildId: context.guildId, limit: 1 }),
    context.repos.audit.list({ guildId: context.guildId, limit: 1 }),
  ]);

  return (
    <div>
      <h2>Tickets</h2>
      <div className="grid">
        <StatCard label="Max open per user" value={String(read('maxOpenPerUser', 1))} />
        <StatCard label="Staff roles" value={String(read<string[]>('staffRoleIds', []).length)} />
        <StatCard
          label="Categories"
          value={String(read<Array<unknown>>('categories', []).length)}
        />
        <StatCard label="Config writes" value={open.length} detail="dashboard changes recorded" />
        <StatCard
          label="Audit entries"
          value={claimed.length}
          detail={closed.length ? 'most recent below' : undefined}
        />
      </div>
      <SettingsForm
        guildId={context.guildId}
        group="tickets"
        fields={[
          {
            key: 'enabled',
            label: 'Tickets enabled',
            type: 'boolean',
            value: read('enabled', false),
          },
          {
            key: 'categoryId',
            label: 'Ticket category ID',
            type: 'text',
            value: read('categoryId', ''),
          },
          {
            key: 'logChannelId',
            label: 'Ticket log channel ID',
            type: 'text',
            value: read('logChannelId', ''),
          },
          {
            key: 'staffRoleIds',
            label: 'Staff role IDs',
            type: 'list',
            value: read<string[]>('staffRoleIds', []),
          },
          {
            key: 'maxOpenPerUser',
            label: 'Max open tickets per user',
            type: 'number',
            value: read('maxOpenPerUser', 1),
            min: 1,
            max: 10,
          },
          {
            key: 'ratingEnabled',
            label: 'Allow ticket ratings',
            type: 'boolean',
            value: read('ratingEnabled', true),
          },
          {
            key: 'closeConfirmation',
            label: 'Confirm before closing',
            type: 'boolean',
            value: read('closeConfirmation', true),
          },
        ]}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Transcripts are only returned to the opener, the claiming staff member, or a bot owner -
        enforced in
        <code>TicketService.transcript</code>, not in the UI.
      </p>
    </div>
  );
}
