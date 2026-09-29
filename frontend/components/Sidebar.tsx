'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { NAV_ITEMS, canAccess, isActivePath, type NavItem } from '@/lib/nav';
import { useNav } from './nav/NavProvider';

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

export function Sidebar() {
  const pathname = usePathname();
  const { isOpen, close } = useNav();
  const { activeUser } = useWorkspace();
  // The signed-in person, with any local profile edits applied. Read from the
  // store rather than a prop so switching persona updates the whole shell.
  const me = useActivePerson();

  // Hidden for a role that cannot use the page. `/hr` is additionally blocked
  // by RoleGate, because a missing nav entry does not stop anyone typing the URL.
  const items = NAV_ITEMS.filter((item) => canAccess(item, activeUser.role));

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
          {items.map((item) => (
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
            <PersonAvatar person={me} size="sm" />
            <div className="profile-mini-text">
              <strong>{me.name}</strong>
              <small>{me.jobTitle ?? me.email}</small>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
