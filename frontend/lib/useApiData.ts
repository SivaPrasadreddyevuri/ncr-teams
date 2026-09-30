'use client';

/**
 * The one shape every screen uses to read from the API.
 *
 * Without this, each page invents its own loading flag, its own error path and
 * its own idea of what to render when the request fails — and they will not match
 * each other, which is worse than having one mediocre pattern.
 *
 * ## The fallback chain
 *
 *   live API  ->  cache  ->  seed fixtures
 *
 * `fallback` is the seed, passed in from the server component that rendered the
 * page. It is deliberately a prop rather than an import from `lib/data`: that
 * keeps `lib/data` at the edge, in one place, instead of scattering fixture
 * imports across thirteen files. When the seed is no longer needed it is one
 * deletion here plus one at each page.
 *
 * The cache is a single `localStorage` slot per key, so a visitor who has the
 * backend down still sees the last good response instead of an empty page. That
 * matters for a demo: a down API should look like a slow API, not a broken one.
 *
 * ## On silently showing stale data
 *
 * A cache hit looks exactly like a live hit, and `stale` is what tells them
 * apart. Anything rendering that flag should say so. The alternative — showing
 * cached data as though it were current — is the kind of quiet dishonesty that is
 * hard to notice and easy to be caught by.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { readJson, writeJson } from '@/lib/storage';

export type ApiData<T> = {
  /** The value to render. Never undefined once mounted. */
  data: T;
  /** True when the request failed. `data` is then the cache or the seed. */
  error: string | null;
  /**
   * True when `data` came from cache or the seed rather than the network.
   *
   * Nothing reads this yet. It is kept because it is the honest signal for
   * "this is not live data", and the moment a screen shows a stale indicator it
   * is already correct. Delete it if that never happens.
   */
  stale: boolean;
};

/** `true` when the failure is a missing session, which retrying cannot fix. */
function isUnauthorised(error: unknown): boolean {
  return error instanceof ApiError && error.isUnauthorised;
}

export function useApiData<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): ApiData<T> {
  // The seed is the value until something better arrives, so the screen renders
  // immediately and never flashes an empty state on a slow connection.
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  // The fetcher is usually an inline arrow, so it changes identity on every
  // render. Held in a ref so it is not a dependency, which would loop.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStale(false);
        // Only cached after a successful read, so a failed load never
        // overwrites a good cache with nothing.
        writeJson(cacheKey(key), result);
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return;

        const cached = readJson<T>(cacheKey(key));
        if (cached !== null) {
          // A cache hit is better than the seed, but the screen must know.
          setData(cached);
          setStale(true);
        } else {
          setStale(true);
        }

        // A missing session is expected for a visitor who has not signed in, and
        // retrying cannot fix it. Reporting it as an error on every page would be
        // noise, so the seed stands in silently.
        if (!isUnauthorised(cause)) {
          setError(cause instanceof Error ? cause.message : 'Could not reach the server.');
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key]);

  return { data, error, stale };
}

/** Namespaced so a screen's key cannot collide with another part of the app. */
function cacheKey(key: string): string {
  return `ncr-teams:api:${key}`;
}
