import type { Metadata } from 'next';
import './globals.css';
import { ThemeToggle } from '../components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Dcbot dashboard',
  description: 'Configure Dcbot: moderation, security, tickets, economy and leveling.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-dot" aria-hidden="true" />
            Dcbot
          </a>
          <nav className="nav">
            <a href="/docs">Docs</a>
            <a href="/dashboard">Dashboard</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <ThemeToggle />
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            Dcbot - self-hosted Discord bot and dashboard. Data is stored in your own PostgreSQL database.
          </div>
        </footer>
      </body>
    </html>
  );
}
