'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/**
 * Route-level error boundary, so a failed render shows a recoverable message
 * instead of Next's bare error page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] route error:', error);
  }, [error]);

  return (
    <div className="empty-state">
      <div className="section-card">
        <span className="empty-icon">
          <TriangleAlert size={22} />
        </span>

        <h2>Something went wrong</h2>
        <p>This page failed to render. Reloading usually clears it.</p>

        {error.digest && (
          <p className="t-sm" style={{ color: 'var(--muted)' }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}

        <button
          className="join"
          onClick={reset}
          style={{ display: 'inline-flex', gap: 7, alignItems: 'center', marginTop: 8 }}
        >
          <RotateCcw size={15} /> Try again
        </button>

        <p className="empty-meta" style={{ marginTop: 18 }}>
          UI prototype &mdash; all data is in-memory
        </p>
      </div>
    </div>
  );
}
