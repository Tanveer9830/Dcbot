export const metadata = { title: 'Docs - Dcbot' };

export default function DocsPage(): JSX.Element {
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 48 }}>
      <h1>Documentation</h1>
      <p className="muted">
        The full documentation lives in the repository under <code>docs/</code>. This page summarises the setup path.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>1. Create the Discord application</h2>
        <ol>
          <li>Create an application in the Discord Developer Portal and add a bot.</li>
          <li>
            Enable the privileged intents the bot needs: <strong>Server Members</strong>, <strong>Message Content</strong>{' '}
            and <strong>Presence</strong> is <em>not</em> required.
          </li>
          <li>
            Copy the bot token into <code>DISCORD_TOKEN</code> and the application ID into <code>DISCORD_CLIENT_ID</code>.
          </li>
          <li>
            Add <code>BOT_OWNER_IDS</code> as a comma-separated list of user IDs. Both configured owners receive
            identical privileges.
          </li>
        </ol>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>2. Database</h2>
        <p>
          Dcbot uses PostgreSQL only. Set <code>DATABASE_URL</code>, then run <code>npm run migrate</code>. Migrations are
          plain SQL files in <code>database/migrations</code> and are recorded in <code>schema_migrations</code>.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>3. OAuth2</h2>
        <p>
          Add a redirect URI in the portal (for example <code>http://localhost:3000/api/auth/callback</code>) and set{' '}
          <code>DISCORD_CLIENT_SECRET</code>, <code>DISCORD_REDIRECT_URI</code>, <code>DASHBOARD_URL</code> and a
          32+ character <code>SESSION_SECRET</code>. Only the <code>identify</code> and <code>guilds</code> scopes are
          requested.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>4. Register commands</h2>
        <p>
          Run <code>npm run deploy-commands</code>. Set <code>DISCORD_DEV_GUILD_ID</code> for instant guild-scoped
          registration during development; leave it empty (or pass <code>--global</code>) for global registration.
          Commands are not re-registered on every bot start.
        </p>
      </div>

      <div className="card">
        <h2>5. Music (optional)</h2>
        <p>
          Music playback needs a running Lavalink v4 node. Set <code>MUSIC_ENABLED=true</code>,{' '}
          <code>LAVALINK_HOST</code>, <code>LAVALINK_PORT</code> and <code>LAVALINK_PASSWORD</code>. Spotify links are
          resolved through the Spotify Web API into metadata and then searched on your configured playback source - this
          bot does not stream Spotify audio, which Spotify&apos;s terms do not permit for third-party bots.
        </p>
      </div>
    </div>
  );
}
