'use client';

import { useEffect, useState } from 'react';
import { Check, X, Plane } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { SectionCard } from '@/components/SectionCard';
import { formatDayLabel, formatTime24 } from '@/lib/format';
import { api } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import type { LeaveRequestDto } from '@/lib/api';

const TONE = { PENDING: 'tone-orange', APPROVED: 'tone-blue', REJECTED: 'tone-pink' } as const;

/** "Wed 30 Sept, 09:00 → Thu 1 Oct, 17:00" — the window a request covers. */
function windowFor(row: { from: string; to: string }): string {
  return `${formatDayLabel(new Date(row.from))}, ${formatTime24(new Date(row.from))} → ${formatDayLabel(new Date(row.to))}, ${formatTime24(new Date(row.to))}`;
}

export function LeaveTable() {
  const { decideLeave, leaveError, activeUserId } = useWorkspace();
  const people = useDirectory();

  /**
   * The whole workspace's pending requests, from HR's queue.
   *
   * Read here rather than from the provider's `leaveRequests`, because those are the
   * signed-in user's own rows plus whatever fixtures are cached -- an approver's
   * board is everybody's requests, which the personal endpoint deliberately cannot
   * return. The provider still owns `decideLeave` so the optimistic update and the
   * save live in one place.
   */
  const queue = useApiData<LeaveRequestDto[]>(
    'leave-queue',
    (signal) => api.leaveQueue('PENDING', signal).then((r) => r.requests),
    // The fixture rows are Alex's own requests, which are not HR's queue, so they
    // are the wrong seed. An empty list is the honest fallback: it renders as an
    // empty queue rather than as someone else's leave shown to the wrong person.
    [],
  );

  const [rows, setRows] = useState<LeaveRequestDto[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);

  useEffect(() => setRows(queue.data), [queue.data]);

  function decide(id: string, status: 'APPROVED' | 'REJECTED') {
    setDeciding(id);
    // The active user id is passed for the optimistic row only. The server takes the
    // signer from the session and would reject an attempt to supply one.
    decideLeave(id, status, activeUserId);
    setDeciding(null);
  }

  return (
    <div className="grid-2">
      <SectionCard title="Leave Requests" href="/leave">
        {rows.filter((row) => row.status === 'PENDING').length > 0 && (
          <small className="leave-queue-note">
            {rows.filter((row) => row.status === 'PENDING').length} waiting on a decision. Only
            HR can approve or reject.
          </small>
        )}

        {leaveError && (
          <small className="form-error" role="alert">
            {leaveError}
          </small>
        )}

        {queue.stale && rows.length === 0 && (
          <small style={{ color: 'var(--muted)' }}>
            Could not reach the server. Showing nothing rather than a stale queue.
          </small>
        )}

        {rows.map((row) => {
          // Prefer the party the API joined; fall back to the directory for the
          // fixture rows, which carry an id rather than an object.
          // The API joins the requester in; the fixture rows carry an id instead, so
          // the directory is the fallback. `online` only exists on a full Person, so
          // it is read from the directory entry rather than assumed.
          const directoryEntry = people.find((p) => p.id === row.userId) ?? null;
          const name = row.user?.name ?? directoryEntry?.name ?? 'Unknown';

          return (
            <div className="meeting-row" key={row.id}>
              <PersonAvatar
                person={directoryEntry}
                size="sm"
                online={directoryEntry?.online}
              />
              <div className="meeting-info">
                <strong>
                  {name} &bull; {row.days} day{row.days === 1 ? '' : 's'}
                </strong>
                <small>
                  {row.type.charAt(0) + row.type.slice(1).toLowerCase()} &bull;{' '}
                  {windowFor(row)}
                </small>
                {row.reason && <small className="leave-reason">{row.reason}</small>}
                {row.decidedBy && (
                  <small>
                    {row.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {row.decidedBy.name}
                    {row.decidedAt ? ` on ${formatDayLabel(new Date(row.decidedAt))}` : ''}
                  </small>
                )}
                {row.decisionNote && (
                  <small className="leave-reason">Note: {row.decisionNote}</small>
                )}
              </div>

              <span className="chip">{row.status.toLowerCase()}</span>

              {row.status === 'PENDING' && (
                <div className="leave-decide">
                  <button
                    className="icon-btn"
                    type="button"
                    disabled={deciding === row.id}
                    onClick={() => decide(row.id, 'APPROVED')}
                    aria-label={`Approve ${name}'s request`}
                    title="Approve"
                    style={{ color: '#2ea043' }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    disabled={deciding === row.id}
                    onClick={() => decide(row.id, 'REJECTED')}
                    aria-label={`Reject ${name}'s request`}
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

        {rows.length === 0 && (
          <small style={{ color: 'var(--muted)' }}>
            Nothing waiting on a decision.
          </small>
        )}
      </SectionCard>

      <SectionCard title="Summary">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((status) => {
          const matching = rows.filter((row) => row.status === status);
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
