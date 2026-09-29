'use client';

import { Check, X, Plane } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { SectionCard } from '@/components/SectionCard';
import { formatDate } from '@/lib/format';
import type { LeaveRequest } from '@/lib/data';

const TONE = { PENDING: 'tone-orange', APPROVED: 'tone-blue', REJECTED: 'tone-pink' } as const;

export function LeaveTable() {
  // Read from the store rather than a local copy. That is what makes an
  // employee's request visible here at all: it used to be seeded from a module
  // fixture, so a request submitted anywhere else in the app could never appear.
  const { leaveRequests, decideLeave, activeUserId } = useWorkspace();
  // A request can belong to the signed-in user, so names come from the profile
  // store rather than the static lookup.
  const people = useDirectory();

  function decide(id: string, status: LeaveRequest['status']) {
    decideLeave(id, status, activeUserId);
  }

  return (
    <div className="grid-2">
      <SectionCard title="Leave Requests">
        {leaveRequests.map((row) => {
          const person = people.find((p) => p.id === row.userId);
          return (
            <div className="meeting-row" key={row.id}>
              <PersonAvatar person={person} size="sm" online={person?.online} />
              <div className="meeting-info">
                <strong>{person?.name ?? 'Unknown'}</strong>
                <small>
                  {row.type.toLowerCase()} &bull; {formatDate(row.from)} &rarr; {formatDate(row.to)}{' '}
                  &bull; {row.reason}
                </small>
              </div>
              <span className="chip">{row.status.toLowerCase()}</span>
              {row.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => decide(row.id, 'APPROVED')}
                    aria-label={`Approve ${person?.name}'s request`}
                    style={{ color: '#2ea043' }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => decide(row.id, 'REJECTED')}
                    aria-label={`Reject ${person?.name}'s request`}
                    style={{ color: '#e5534b' }}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Summary">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((status) => {
          const count = leaveRequests.filter((row) => row.status === status).length;
          return (
            <div className="meeting-row" key={status}>
              <span className={`activity-icon ${TONE[status]}`}>
                {status === 'PENDING' ? (
                  <Plane size={14} />
                ) : status === 'APPROVED' ? (
                  <Check size={14} />
                ) : (
                  <X size={14} />
                )}
              </span>
              <div className="meeting-info">
                <strong>{status.toLowerCase()}</strong>
                <small>
                  {count} request{count === 1 ? '' : 's'}
                </small>
              </div>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}
