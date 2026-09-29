import { UsersRound } from 'lucide-react';

/**
 * The brand mark. When `onClick` is supplied it doubles as the navigation
 * toggle, which keeps the sidebar's own logo as the single nav control.
 */
export function Logo({
  compact = false,
  onClick,
  navState,
}: {
  compact?: boolean;
  onClick?: () => void;
  navState?: 'expanded' | 'rail' | 'hidden';
}) {
  if (!onClick) {
    return (
      <div className="brand">
        <span className="brand-mark">
          <UsersRound size={compact ? 17 : 22} />
        </span>
        {!compact && <span className="brand-name">NCR Teams</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="brand brand-toggle"
      onClick={onClick}
      aria-label={navState === 'expanded' ? 'Collapse navigation' : 'Expand navigation'}
      aria-expanded={navState !== 'hidden'}
      aria-controls="primary-navigation"
      title={navState === 'expanded' ? 'Collapse navigation' : 'Expand navigation'}
    >
      <span className="brand-mark">
        <UsersRound size={22} />
      </span>
      <span className="brand-name">NCR Teams</span>
    </button>
  );
}
