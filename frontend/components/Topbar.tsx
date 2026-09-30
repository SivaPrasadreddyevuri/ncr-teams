'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bell, Search, Plus, ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { titleForPath } from '@/lib/nav';
import { api } from '@/lib/api';
import { useNav } from './nav/NavProvider';
import type { Person } from '@/lib/data';

const ROLE_LABEL: Record<Person['role'], string> = {
  HR_ADMIN: 'HR',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isOpen, toggle } = useNav();
  // The signed-in person comes from the workspace store, so switching persona
  // updates the whole shell, and local profile edits reach the menu.
  const me = useActivePerson();
  const { signOut } = useWorkspace();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState('');

  const title = titleForPath(pathname);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!term.trim()) return;
    router.push(`/search?q=${encodeURIComponent(term.trim())}`);
    setMenuOpen(false);
  }

  async function handleSignOut() {
    // End the server session before clearing local state.
    //
    // A session is a row, and the cookie is httpOnly, so clearing local state
    // alone does not end it: the token stays valid on the server and every
    // subsequent request would still be authenticated. That is the one thing
    // signing out has to do.
    //
    // Local state is cleared either way. A failed request means the API is down,
    // and refusing to sign out in that case would trap the user in an app they
    // have chosen to leave.
    try {
      await api.logout();
    } catch {
      // Deliberately swallowed. The server session may survive if this failed,
      // which is worth knowing but not worth blocking on -- and there is nothing
      // the user could do about it here anyway.
    }

    signOut();
    setMenuOpen(false);
    router.push('/login');
  }

  return (
    <header className="topbar">
      <button
        className="icon-btn nav-toggle"
        onClick={toggle}
        aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isOpen}
        aria-controls="primary-navigation"
      >
        {isOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <div className="topbar-title">
        <h1>{title}</h1>
        <span className="crumb">NCR Teams workspace</span>
      </div>

      <div className="top-actions">
        <form onSubmit={onSearch} className="search">
          <Search size={17} />
          <input
            placeholder="Search (Ctrl + K)"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            aria-label="Search the workspace"
          />
        </form>

        <Link className="icon-btn" href="/calendar" aria-label="Go to calendar">
          <Plus size={18} />
        </Link>

        <Link className="icon-btn" href="/activity" aria-label="Go to activity">
          <Bell size={18} />
        </Link>

        <div className="profile-menu-wrap">
          <button
            className="profile-btn"
            onClick={() => setMenuOpen((current) => !current)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <PersonAvatar person={me} size="sm" />
            <ChevronDown size={15} />
          </button>

          {menuOpen && (
            <>
              <div
                className="menu-backdrop"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="user-menu" role="menu">
                <div className="user-menu-head">
                  <PersonAvatar person={me} size="sm" />
                  <div>
                    <strong>{me.name}</strong>
                    <small>{me.jobTitle ?? me.role}</small>
                  </div>
                  {/* The role is what decides which nav items and pages this
                      person can reach, so it is worth showing explicitly. */}
                  <span className="chip tiny" style={{ marginLeft: 'auto' }}>
                    {ROLE_LABEL[me.role]}
                  </span>
                </div>

                <Link
                  className="user-menu-item"
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Account settings
                </Link>

                <button className="user-menu-item danger" role="menuitem" onClick={handleSignOut}>
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {searchOpen && term.trim().length > 1 && (
          <div className="search-hint" onClick={() => setSearchOpen(false)}>
            Press Enter to search for &ldquo;{term.trim()}&rdquo;
          </div>
        )}
      </div>
    </header>
  );
}
