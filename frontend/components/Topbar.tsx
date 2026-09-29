'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bell, Search, Plus, ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useResolvedPerson } from '@/components/profile/ProfileProvider';
import { titleForPath } from '@/lib/nav';
import { useNav } from './nav/NavProvider';
import type { Person } from '@/lib/data';

export function Topbar({ user }: { user: Person }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isOpen, toggle } = useNav();
  // Resolved from the local profile so a rename in Settings reaches the menu.
  const me = useResolvedPerson(user);

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

  function onSignOut() {
    // Prototype: there is no session, so this just returns to the login screen.
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
            <PersonAvatar person={user} size="sm" />
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
                  <PersonAvatar person={user} size="sm" />
                  <div>
                    <strong>{me?.name}</strong>
                    <small>{me?.jobTitle ?? me?.role}</small>
                  </div>
                </div>

                <Link
                  className="user-menu-item"
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Account settings
                </Link>
                <Link
                  className="user-menu-item"
                  href="/verify-2fa"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Security &amp; two-factor
                </Link>

                <button className="user-menu-item danger" role="menuitem" onClick={onSignOut}>
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
