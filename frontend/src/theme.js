import { useEffect, useState } from 'react';

// Light/dark theme. Follows the system setting until the user picks one with the toggle;
// the pick is remembered. index.html sets data-theme before first paint (same rules as
// resolveTheme) so the page never flashes the wrong theme.

const STORAGE_KEY = 'theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function resolveTheme() {
  return storedTheme() ?? (darkQuery().matches ? 'dark' : 'light');
}

// the theme currently on the page; imperative map code reads this
export const isDark = () => document.documentElement.dataset.theme === 'dark';

export function useTheme() {
  const [theme, setTheme] = useState(resolveTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // browser chrome (mobile address bar) matches the app background
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  // follow system changes unless the user has picked a theme
  useEffect(() => {
    const mq = darkQuery();
    const onChange = () => { if (!storedTheme()) setTheme(mq.matches ? 'dark' : 'light'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      // picking the system theme again goes back to following the system
      if (next === (darkQuery().matches ? 'dark' : 'light')) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage blocked: the toggle still works for this visit */ }
    setTheme(next);
  };

  return [theme, toggleTheme];
}
