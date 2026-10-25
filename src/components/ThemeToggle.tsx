import { useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'sah-assessor:theme';

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyStoredTheme() {
  document.documentElement.classList.toggle('dark', storedTheme() === 'dark');
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button type="button" className="btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      {theme === 'dark' ? 'Light' : 'Dark'} theme
    </button>
  );
}
