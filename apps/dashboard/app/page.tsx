import Link from 'next/link';
import { getSession } from '../lib/session';
import { configProblems } from '../lib/env';

export const dynamic = 'force-dynamic';

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Moderation that checks first',
    body: 'Bans, kicks, timeouts, warnings and cases with role-hierarchy validation before anything is sent to Discord.',
  },
  {
    title: 'Security monitoring',
    body: 'Anti-raid, anti-spam, anti-nuke via audit log, trusted users and roles, emergency lockdown, and an event history.',
  },
  {
    title: 'Mention and pin protection',
    body: '/no-tag and /no-pin with exemptions, configurable responses and an audit trail - honest about what Discord allows.',
  },
  {
    title: 'Tickets, giveaways, polls',
    body: 'Support tickets with transcripts and ratings, giveaways with a testable draw, polls, suggestions and reaction roles.',
  },
  {
    title: 'Economy and leveling',
    body: 'Transactional wallet and bank, idempotent rewards, quests, XP with anti-farm cooldowns and role rewards.',
  },
  {
    title: 'Your data, your database',
    body: 'PostgreSQL with versioned migrations. No third-party analytics and no MongoDB anywhere in this project.',
  },
];

export default async function LandingPage(): Promise<JSX.Element> {
  const session = await getSession();
  const problems = configProblems();

  return (
    <div className="container">
      <section className="hero">
        <h1>A self-hosted Discord bot you actually control</h1>
        <p>
          Dcbot pairs a modular discord.js bot with a Next.js dashboard. Configure moderation, security, tickets,
          economy and leveling from the browser - every write is re-authorized on the server.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {session ? (
            <Link className="btn btn-primary" href="/dashboard">
              Open dashboard
            </Link>
          ) : (
            <Link className="btn btn-primary" href="/api/auth/login">
              Sign in with Discord
            </Link>
          )}
          <Link className="btn" href="/docs">
            Read the docs
          </Link>
        </div>
      </section>

      {problems.missing.length > 0 ? (
        <div className="alert">
          This instance is missing configuration: <code>{problems.missing.join(', ')}</code>. Sign-in and settings
          writes will not work until these are set. See <code>.env.example</code>.
        </div>
      ) : null}

      <section className="features">
        {FEATURES.map((feature) => (
          <div className="card" key={feature.title}>
            <h3>{feature.title}</h3>
            <p className="muted">{feature.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
