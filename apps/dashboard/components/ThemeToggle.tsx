'use client';

import { useEffect, useState } from 'react';

/** Dark/light toggle persisted to localStorage. Default is dark. */
export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem('dcbot-theme');
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
    }
  }, []);

  const toggle = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    window.localStorage.setItem('dcbot-theme', next);
    document.documentElement.dataset.theme = next;
  };

  return (
    <button className="btn" onClick={toggle} aria-label="Toggle colour theme" type="button">
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}
