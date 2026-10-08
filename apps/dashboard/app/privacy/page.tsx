export const metadata = { title: 'Privacy - Dcbot' };

export default function PrivacyPage(): JSX.Element {
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 48, maxWidth: 820 }}>
      <h1>Privacy</h1>
      <div className="card">
        <p>
          Dcbot is self-hosted. The data below is stored in <em>your</em> PostgreSQL database; nothing is sent to any
          third party except Discord&apos;s own API.
        </p>
        <h3>What is stored</h3>
        <ul>
          <li>Discord IDs for users, roles, channels and servers referenced by commands.</li>
          <li>Moderation cases, warnings and security events, with the reason you supplied.</li>
          <li>Economy balances, XP profiles, tickets and their recorded transcript text.</li>
          <li>Dashboard sessions as SHA-256 token hashes plus your Discord display name.</li>
        </ul>
        <h3>What is not stored</h3>
        <ul>
          <li>Plaintext OAuth access or refresh tokens - the session cookie is encrypted and the database holds hashes.</li>
          <li>Client IP addresses - audit rows store a SHA-256 hash only.</li>
          <li>Message content beyond what a configured feature needs (AutoMod evaluation, ticket transcripts, edit logs).</li>
        </ul>
        <h3>Retention</h3>
        <p>
          Security events, audit rows and pin/tag logs older than the configured retention window (default 90 days) are
          deleted by the housekeeping job. You can prune sooner with <code>prune_old_rows(days)</code> in the database.
        </p>
      </div>
    </div>
  );
}
