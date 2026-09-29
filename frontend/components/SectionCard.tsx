import type { ReactNode } from 'react';

/**
 * A titled panel. `href` turns the action into a real link to the full view;
 * without it, no action control is rendered (an inert button is worse than
 * none, because it looks interactive but does nothing).
 */
export function SectionCard({
  title,
  href,
  children,
  className = '',
}: {
  title: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`section-card ${className}`.trim()}>
      <div className="section-head">
        <h2>{title}</h2>
        {href && (
          <a className="text-btn" href={href}>
            View all
          </a>
        )}
      </div>
      {children}
    </div>
  );
}
