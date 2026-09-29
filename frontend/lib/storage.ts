/**
 * Safe localStorage helpers.
 *
 * Two rules, both of which this codebase has already been bitten by.
 *
 * 1. `window` and `localStorage` do not exist during prerendering. Every route
 *    here is prerendered, so a bare `localStorage.getItem` in a module body or a
 *    `useState` initialiser throws on the server. All access is guarded.
 * 2. Reading storage *during render* is a hydration mismatch waiting to happen.
 *    The server cannot know what is stored, so the first client paint would
 *    disagree with the server HTML. Anything restored from storage must be
 *    applied in an effect, after the first paint has already matched.
 *
 * A private-mode or disabled-storage browser throws on access rather than
 * returning null, so reads are wrapped as well.
 */

const PREFIX = 'ncr-teams:';

export const storageKeys = {
  clockFormat: `${PREFIX}clock-format`,
  profile: `${PREFIX}profile`,
} as const;

/** Read and JSON-parse a key, or return null if absent, corrupt or unavailable. */
export function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** JSON-serialise and store a value. Gives up quietly if storage is full. */
export function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage disabled. The UI already works from React
    // state, so failing to persist is not worth interrupting the user over.
  }
}
