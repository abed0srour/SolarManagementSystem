'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ACCENT_STORAGE_KEY, AccentId, DEFAULT_ACCENT, isAccent } from '../lib/accents';

type AccentContext = {
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
  /** False until the stored value has been read, so the UI can avoid a flicker. */
  ready: boolean;
};

const Ctx = createContext<AccentContext>({ accent: DEFAULT_ACCENT, setAccent: () => {}, ready: false });

export const useAccent = () => useContext(Ctx);

/**
 * Holds the accent choice and mirrors it onto `<html data-accent>`, which is
 * what the CSS variables key off. Deliberately mirrors how next-themes handles
 * light/dark: an attribute on the root element, a value in localStorage, and an
 * inline script that applies it before paint.
 *
 * Changing the accent repaints instantly — no reload — because every component
 * already resolves its colour through `--primary` / `--ring` at style time.
 */
export default function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);
  const [ready, setReady] = useState(false);

  // Adopt whatever the pre-paint script already applied, so React's state and
  // the DOM agree from the first render.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (isAccent(stored)) setAccentState(stored);
    } catch {
      /* storage blocked — fall back to the default */
    }
    setReady(true);
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    const root = document.documentElement;
    // The default is the base stylesheet, so remove the attribute rather than
    // writing a block that does not exist.
    if (next === DEFAULT_ACCENT) root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', next);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return <Ctx.Provider value={{ accent, setAccent, ready }}>{children}</Ctx.Provider>;
}
