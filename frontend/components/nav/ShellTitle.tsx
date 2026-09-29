'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ShellTitleContext = createContext<{
  title: string | null;
  setTitle: (title: string | null) => void;
}>({ title: null, setTitle: () => {} });

/**
 * Holds an optional page-level title override.
 *
 * Rendered in the layout so that both the topbar (which reads it) and the page
 * (which sets it) are inside the same provider. Pages opt in by rendering
 * <ShellTitle />; everything else falls back to the route's title in lib/nav.ts.
 */
export function ShellTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  // Reset is handled by <ShellTitle>'s cleanup on unmount, so navigating away
  // from an overriding page falls back to the route title automatically.
  const value = useMemo(() => ({ title, setTitle }), [title]);

  return <ShellTitleContext.Provider value={value}>{children}</ShellTitleContext.Provider>;
}

/**
 * Page-level title override, for titles that are data-driven rather than fixed
 * by the route (an individual meeting's name, a search term).
 *
 * Also mirrors it into the browser tab, which static `metadata` cannot do for
 * dynamic values.
 */
export function ShellTitle({ title }: { title: string }) {
  const { setTitle } = useContext(ShellTitleContext);

  useEffect(() => {
    setTitle(title);
    document.title = `${title} · NCR Teams`;

    return () => setTitle(null);
  }, [title, setTitle]);

  return null;
}

/** The current override, or null when the page has not set one. */
export function useShellTitle(): string | null {
  return useContext(ShellTitleContext).title;
}
