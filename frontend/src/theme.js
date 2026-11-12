import { useEffect, useState } from 'react';

// Light/dark theme. Light is the default regardless of the system setting; dark mode is
// opt-in with the toggle, and the pick is remembered. index.html sets data-theme before
// first paint (same rules as resolveTheme) so the page never flashes the wrong theme.

const STORAGE_KEY = 'theme';

function storedTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function resolveTheme() {
  return storedTheme() ?? 'light';
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

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      // light is the default, so only a dark pick needs remembering
      if (next === 'light') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage blocked: the toggle still works for this visit */ }
    setTheme(next);
  };

  return [theme, toggleTheme];
}
