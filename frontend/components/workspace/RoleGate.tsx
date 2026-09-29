'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useWorkspace } from './WorkspaceProvider';
import type { Person } from '@/lib/data';

const ROLE_LABEL: Record<Person['role'], string> = {
  HR_ADMIN: 'HR administrator',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

/**
 * Blocks a page from roles that may not use it.
 *
 * This is a client-side guard on a *prerendered* route, and that distinction
 * matters: the markup for the page is already in the public HTML, so a determined
 * visitor can read it in view-source even though the UI never shows it. For a
 * prototype that is an acceptable limit, and it is a real one only when a server
 * enforces the same rule.
 *
 * Two things it does do properly. It renders a neutral placeholder rather than the
 * children until the role is known, so HR content does not flash on screen for a
 * second during hydration. And it links somewhere useful instead of bouncing
 * silently, which reads as a broken link.
 */
export function RoleGate({
  roles,
  children,
  what,
}: {
  roles: Person['role'][];
  children: React.ReactNode;
  /** Noun for the message, e.g. "HR tools". */
  what: string;
}) {
  const { activeUser, ready } = useWorkspace();

  if (!ready) {
    return (
      <div className="panel gate-pending" aria-busy="true">
        <span className="sr-only">Checking access</span>
      </div>
    );
  }

  if (roles.includes(activeUser.role)) {
    return <>{children}</>;
  }

  return (
    <div className="panel gate-denied">
      <span className="activity-icon tone-orange">
        <ShieldAlert size={18} />
      </span>

      <div>
        <h2>You do not have access to {what}</h2>
        <p>
          You are signed in as {activeUser.name}, a{' '}
          {ROLE_LABEL[activeUser.role]}. {what} is only available to other roles.
        </p>

        <div className="gate-actions">
          <Link className="join" href="/">
            Back to dashboard
          </Link>
          <Link className="btn-secondary" href="/leave">
            My leave requests
          </Link>
        </div>
      </div>
    </div>
  );
}
