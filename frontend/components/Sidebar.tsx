'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { Avatar } from './Avatar';
import { initials } from '@/lib/format';
import { NAV_ITEMS, isActivePath, type NavItem } from '@/lib/nav';
import { useNav } from './nav/NavProvider';
import type { Person } from '@/lib/data';

type NavRow = { item: NavItem; active: boolean; onNavigate: () => void };

function NavRow({ item, active, onNavigate }: NavRow) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={active ? 'nav-item active' : 'nav-item'}
      data-label={item.label}
      title={item.label}
    >
      <item.icon size={18} />
      <span className="nav-label">{item.label}</span>
      {/* Reference layout marks unread activity. */}
      {item.badge ? <b className="dot">{item.badge}</b> : null}
    </Link>
  );
}

export function Sidebar({ user }: { user: Person }) {
  const pathname = usePathname();
  const { isOpen, close } = useNav();

  const navigate = () => {
    if (isOpen) close();
  };

  return (
    <>
      <div
        className={isOpen ? 'nav-scrim visible' : 'nav-scrim'}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        id="primary-navigation"
        className={isOpen ? 'sidebar drawer-open' : 'sidebar'}
        aria-label="Primary"
      >
        <div className="sidebar-brand">
          <Link href="/" onClick={close}>
            <Logo />
          </Link>
        </div>

        <nav>
          {NAV_ITEMS.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              active={isActivePath(pathname, item.href)}
              onNavigate={navigate}
            />
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile-mini">
            <Avatar initials={initials(user.name)} size="sm" />
            <div className="profile-mini-text">
              <strong>{user.name}</strong>
              <small>{user.jobTitle ?? user.email}</small>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
