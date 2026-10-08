'use client';

import { usePathname } from 'next/navigation';

interface SidebarProps {
  guildId: string;
  showOwner?: boolean;
}

const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string }> }> = [
  { title: 'Overview', items: [{ href: '', label: 'Dashboard' }] },
  {
    title: 'Moderation',
    items: [
      { href: '/moderation', label: 'Moderation' },
      { href: '/automod', label: 'AutoMod' },
      { href: '/security', label: 'Security' },
      { href: '/logging', label: 'Logging' },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/welcome', label: 'Welcome' },
      { href: '/tickets', label: 'Tickets' },
      { href: '/leveling', label: 'Leveling' },
      { href: '/economy', label: 'Economy' },
      { href: '/commands', label: 'Custom commands' },
    ],
  },
  { title: 'Records', items: [{ href: '/audit', label: 'Audit log' }] },
];

export function Sidebar({ guildId, showOwner }: SidebarProps): JSX.Element {
  const pathname = usePathname();
  const base = `/dashboard/${guildId}`;
  const isActive = (href: string): boolean =>
    href === '' ? pathname === base : pathname.startsWith(`${base}${href}`);

  return (
    <nav className="sidebar" aria-label="Server settings">
      <a href="/dashboard" className="muted">
        ← All servers
      </a>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className="sidebar-section">{section.title}</div>
          {section.items.map((item) => (
            <a
              key={item.href}
              href={`${base}${item.href}`}
              className={isActive(item.href) ? 'active' : undefined}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
      ))}
      {showOwner ? (
        <div>
          <div className="sidebar-section">Bot owner</div>
          <a href="/owner" className={pathname.startsWith('/owner') ? 'active' : undefined}>
            Owner panel
          </a>
        </div>
      ) : null}
    </nav>
  );
}
