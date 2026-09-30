'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { skeletonFor } from '@/components/skeletons';

/**
 * How long the skeleton holds on an in-app navigation.
 *
 * One second is long enough to read a page's structure at a glance and short
 * enough that clicking through the app does not feel sluggish. It was three
 * seconds, which made the whole demo feel broken. Below roughly 700ms the
 * skeleton stops reading as a loading state at all and just looks like a flicker.
 */
const LOADING_MS = 1000;

/**
 * Shortened under `prefers-reduced-motion`, kept at a fifth of the main wait.
 *
 * The shimmer is already disabled for these users, so a full-length wait would
 * mean a full-length *static* grey page -- strictly worse than the animated one,
 * not better. The ratio matters more than the absolute number: at 600ms against
 * a 1s wait this was 60% of the delay, which all but cancelled the point of the
 * branch, so it now tracks `LOADING_MS`.
 */
const REDUCED_MOTION_MS = LOADING_MS / 5;

/**
 * Shows a structural skeleton between in-app navigations.
 *
 * The reason this exists at all: every route in this app is prerendered, so
 * nothing is ever slow, and Next's own `loading.tsx` never fires. The skeleton
 * components were already written and reachable only by Suspense, which for
 * static routes never suspends. This makes them visible.
 *
 * Two decisions worth stating, because neither is the obvious one:
 *
 * **A hard load shows nothing.** The first effect run is skipped, so a refresh
 * paints real content immediately. The alternative -- holding first paint for
 * the full skeleton delay -- makes the app look slower than it is, and first
 * impressions are the part worth protecting. Detecting the difference leans on
 * `usePathname` changing: a navigation re-renders this component with a new
 * value, a hard load only ever mounts it once.
 *
 * **The real markup stays in the DOM.** The page is `hidden` while loading, so
 * it remains in the static HTML for crawlers and is revealed instantly with
 * nothing to fetch. `hidden` rather than unmounting is the whole point; removing
 * the content would make the app JS-dependent and leave the static HTML nearly
 * empty.
 */
export function RouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  // Seeded with the current path, so the first effect run finds them equal and
  // returns early. This is what separates a hard load from a navigation.
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    setLoading(true);

    const delay =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? REDUCED_MOTION_MS
        : LOADING_MS;

    const timer = window.setTimeout(() => setLoading(false), delay);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!loading) return <>{children}</>;

  const Skeleton = skeletonFor(pathname);

  return (
    <>
      {/* Kept mounted and merely hidden: in the static HTML for crawlers, out of
          the visual and accessibility trees while the skeleton stands in. */}
      <div hidden aria-hidden="true">
        {children}
      </div>
      <div className="route-skeleton">
        <Skeleton />
      </div>
    </>
  );
}
