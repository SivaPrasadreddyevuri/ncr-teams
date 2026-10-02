'use client';

import type { TypingPeer } from './types';

type Props = {
  peers: TypingPeer[];
  /** Epoch ms from the caller, so expiry needs no clock of its own. */
  now: number;
};

/**
 * "Sarah is typing…"
 *
 * Nothing renders when nobody is, rather than an empty reserved row -- a gap in the
 * layout every time the last person stops typing looks like a loading state.
 *
 * Two peers get "A and B are typing", three or more gets "3 people are typing".
 * Naming everyone in a busy channel produces a sentence nobody can read.
 */
export function TypingIndicator({ peers, now }: Props) {
  const active = peers.filter((peer) => peer.expiresAt > now);
  if (active.length === 0) return null;

  const names = active.map((peer) => peer.name);

  let label: string;
  if (names.length === 1) {
    label = `${names[0]} is typing`;
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are typing`;
  } else {
    label = `${names.length} people are typing`;
  }

  return (
      <p
        className="typing-indicator"
        role="status"
        aria-live="polite"
        // Hook for the browser harness. The rendered sentence changes shape with the
        // peer count ("A is typing", "A and B are typing", "3 people are typing"), so
        // a test asserting on it would have to branch three ways; this exposes the
        // count and the names instead.
        data-testid="typing-indicator"
        data-count={active.length}
        data-names={names.join(',')}
      >
      <span className="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
      <span aria-hidden="true">…</span>
    </p>
  );
}
