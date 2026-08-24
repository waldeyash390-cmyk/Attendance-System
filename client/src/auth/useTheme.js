import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'attendance-theme';
const VALID = new Set(['light', 'dark']);

function readInitial() {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && VALID.has(saved)) return saved;
  } catch {
    // ignore quota / disabled storage
  }
  return 'light';
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function getStoredTheme() {
  return readInitial();
}

export function applyStoredTheme() {
  applyTheme(readInitial());
}

export function useTheme() {
  const [theme, setTheme] = useState(readInitial);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore quota / disabled storage
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
