/**
 * Shimmering loading placeholders.
 *
 * One shimmer sweep, reused everywhere, so a page skeleton is assembled from a
 * handful of primitives rather than bespoke CSS. Respects
 * `prefers-reduced-motion` (see globals.css) by stopping the animation.
 */

type SkeletonProps = {
  className?: string;
  /** Rounded pill, for avatars and chips. */
  circle?: boolean;
  style?: React.CSSProperties;
};

export function Skeleton({ className = '', circle = false, style }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${circle ? 'skeleton-circle' : ''} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    />
  );
}

/** A block of text lines; `lines` renders that many rows. */
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-stack ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          style={{ width: index === lines - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-card ${className}`.trim()} aria-hidden="true">
      <Skeleton circle className="skeleton-icon" />
      <div className="skeleton-card-body">
        <Skeleton style={{ height: 13, width: '58%' }} />
        <Skeleton style={{ height: 12, width: '86%' }} />
      </div>
    </div>
  );
}

/** Table header plus `rows` placeholder rows. */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-table ${className}`.trim()} aria-hidden="true">
      <div className="skeleton-table-row head">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} style={{ height: 11 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="skeleton-table-row" key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              style={{ height: 12, width: columnIndex === 0 ? '72%' : '48%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Wraps a page skeleton in the standard status region. */
export function SkeletonPage({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="skeleton-page" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
