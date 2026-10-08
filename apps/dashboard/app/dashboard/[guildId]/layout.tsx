import { Sidebar } from '../../../components/Sidebar';
import { GuildPageDenied, loadGuildPage } from '../../../lib/guildPage';

export const dynamic = 'force-dynamic';

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { guildId: string };
}): Promise<JSX.Element> {
  let context;
  try {
    context = await loadGuildPage(params.guildId);
  } catch (error) {
    if (error instanceof GuildPageDenied) {
      return (
        <div className="container" style={{ paddingTop: 48 }}>
          <div className="card">
            <h1>{context?.guildName ?? 'Access denied'}</h1>
            <div className="alert alert-error">{error.message}</div>
            <a className="btn" href="/dashboard">
              Back to servers
            </a>
          </div>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="layout">
      <Sidebar guildId={context.guildId} showOwner={context.isOwner} />
      <div>
        <h1 style={{ marginBottom: 4 }}>{context.guildName}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Server ID <code>{context.guildId}</code>
        </p>
        {children}
      </div>
    </div>
  );
}
