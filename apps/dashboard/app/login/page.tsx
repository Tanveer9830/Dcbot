import Link from 'next/link';
import { redirect } from 'next/navigation';
import { configProblems } from '../../lib/env';
import { getSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

const ERROR_TEXT: Record<string, string> = {
  no_code: 'Discord did not return an authorization code.',
  state_mismatch: 'The login state did not match - the link probably expired. Try again.',
  token_exchange:
    'Discord rejected the token exchange. Check DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI.',
  user_fetch: 'Could not fetch your Discord profile. Try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}): Promise<JSX.Element> {
  const session = await getSession();
  if (session) redirect('/dashboard');
  const problems = configProblems();

  return (
    <div className="container" style={{ paddingTop: 64 }}>
      <div className="card" style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center' }}>
        <h1>Sign in</h1>
        <p className="muted">
          Dcbot uses Discord OAuth2. We request <code>identify</code> and <code>guilds</code> only -
          no message content and no DMs.
        </p>
        {searchParams.error ? (
          <div className="alert alert-error">
            {ERROR_TEXT[searchParams.error] ?? 'Sign-in failed.'}
          </div>
        ) : null}
        {problems.missing.length > 0 ? (
          <div className="alert">
            OAuth2 is not fully configured on this server. Missing:{' '}
            <code>{problems.missing.join(', ')}</code>
          </div>
        ) : null}
        <Link className="btn btn-primary" href="/api/auth/login">
          Continue with Discord
        </Link>
      </div>
    </div>
  );
}
