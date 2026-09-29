'use client';

import { Check, X, Plane } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { SectionCard } from '@/components/SectionCard';
import { formatDayLabel, formatTime24 } from '@/lib/format';
import type { LeaveRequest } from '@/lib/data';

const TONE = { PENDING: 'tone-orange', APPROVED: 'tone-blue', REJECTED: 'tone-pink' } as const;

/** "Wed 30 Sept, 09:00 → Thu 1 Oct, 17:00" — the window a request covers. */
function windowFor(row: LeaveRequest): string {
  const from = new Date(row.from);
  const to = new Date(row.to);

  return `${formatDayLabel(from)}, ${formatTime24(from)} → ${formatDayLabel(to)}, ${formatTime24(to)}`;
}

export function LeaveTable() {
  // Read from the store rather than a local copy. That is what makes an
  // employee's request visible here at all: it used to be seeded from a module
  // fixture, so a request submitted anywhere else in the app could never appear.
  const { leaveRequests, decideLeave, activeUserId } = useWorkspace();
  // A request can belong to the signed-in user, so names come from the profile
  // store rather than the static lookup.
  const people = useDirectory();

  const pending = leaveRequests.filter((row) => row.status === 'PENDING');

  function decide(id: string, status: LeaveRequest['status']) {
    decideLeave(id, status, activeUserId);
  }

  return (
    <div className="grid-2">
      <SectionCard title="Leave Requests" href="/leave">
        {pending.length > 0 && (
          <small className="leave-queue-note">
            {pending.length} waiting on a decision. Only HR can approve or reject.
          </small>
        )}

        {leaveRequests.map((row) => {
          const person = people.find((p) => p.id === row.userId);
          const decider = people.find((p) => p.id === row.decidedById);

          return (
            <div className="meeting-row" key={row.id}>
              <PersonAvatar person={person} size="sm" online={person?.online} />
              <div className="meeting-info">
                <strong>
                  {person?.name ?? 'Unknown'} &bull; {row.days} day{row.days === 1 ? '' : 's'}
                </strong>
                <small>
                  {row.type.charAt(0) + row.type.slice(1).toLowerCase()} &bull; {windowFor(row)}
                </small>
                <small className="leave-reason">{row.reason}</small>
                {decider && (
                  <small>
                    {row.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {decider.name}
                    {row.decidedAt ? ` on ${formatDayLabel(row.decidedAt)}` : ''}
                  </small>
                )}
              </div>

              <span className="chip">{row.status.toLowerCase()}</span>

              {row.status === 'PENDING' && (
                <div className="leave-decide">
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => decide(row.id, 'APPROVED')}
                    aria-label={`Approve ${person?.name ?? 'this'}'s request`}
                    title="Approve"
                    style={{ color: '#2ea043' }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => decide(row.id, 'REJECTED')}
                    aria-label={`Reject ${person?.name ?? 'this'}'s request`}
                    title="Reject"
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
          const matching = leaveRequests.filter((row) => row.status === status);
          const days = matching.reduce((total, row) => total + row.days, 0);

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
                  {matching.length} request{matching.length === 1 ? '' : 's'} &bull; {days} day
                  {days === 1 ? '' : 's'}
                </small>
              </div>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}
