'use client';

import { useEffect, useState } from 'react';
import { Check, Clock3, Undo2, X } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { formatDayLabel, formatTime24 } from '@/lib/format';
import { api, type LeaveRequestDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';

const STATUS_STYLE: Record<
  LeaveRequestDto['status'],
  { label: string; tone: string; icon: typeof Check }
> = {
  PENDING: { label: 'Awaiting HR', tone: 'tone-orange', icon: Clock3 },
  APPROVED: { label: 'Approved', tone: 'tone-blue', icon: Check },
  REJECTED: { label: 'Rejected', tone: 'tone-red', icon: X },
  // A request the requester withdrew. Its own label rather than a fourth rendering of
  // "rejected", because the two mean opposite things to the person reading them.
  CANCELLED: { label: 'Withdrawn', tone: 'tone-blue', icon: X },
};

/** "Wed 30 Sept, 09:00 → Thu 1 Oct, 17:00" — the window a request actually covers. */
function window_(row: { from: string; to: string }): string {
  const from = new Date(row.from);
  const to = new Date(row.to);

  return `${formatDayLabel(from)}, ${formatTime24(from)} → ${formatDayLabel(to)}, ${formatTime24(to)}`;
}

/**
 * The signed-in person's own requests.
 *
 * An employee can only see their own here, which is the point of keeping this page
 * separate from `/hr`: requesting time off must not require seeing anyone else's.
 */
export function MyLeaveRequests() {
  const { cancelLeaveRequest, leaveError } = useWorkspace();
  // An HR admin also sees the person they decided it, which is the one bit of
  // context a requester does not have. The API joins that person in, so the directory
  // is only a fallback.
  const people = useDirectory();

  /**
   * Read from `myLeave` rather than the provider's shared array.
   *
   * The provider holds the signed-in user's rows *plus* whatever fixtures are cached,
   * so reading it here would show seed rows the database does not have and would
   * change whose leave is on screen when someone switches persona without the server
   * being asked. `myLeave` returns exactly one person's rows because it is the only
   * endpoint that can.
   */
  const requests = useApiData<LeaveRequestDto[]>(
    'my-leave',
    (signal) => api.myLeave({ days: 90 }, signal).then((r) => r.requests),
    // Deliberately no fixture seed. The seed rows belong to several seeded people, so
    // using them would put other people's leave on this page. An empty list is the
    // honest fallback: "I could not load yours" and "you have none" are not the same,
    // which is what `stale` is for below.
    [],
  );

  const [rows, setRows] = useState<LeaveRequestDto[]>([]);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  useEffect(() => setRows(requests.data), [requests.data]);

  /**
   * Withdraws a pending request.
   *
   * Only PENDING offers the control, because the server refuses anything else with
   * a 409: withdrawing approved leave is HR's to reject, so it has to leave a decision
   * on the record rather than quietly vanish.
   */
  function withdraw(id: string) {
    setWithdrawing(id);
    cancelLeaveRequest(id);
    setWithdrawing(null);
  }

  return (
    <SectionCard title="My requests">
      {leaveError && (
        <small className="form-error" role="alert">
          {leaveError}
        </small>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Clock3 size={22} />
          </span>
          <p>{requests.stale ? 'Could not load your requests' : 'No leave requested yet'}</p>
          <span className="empty-meta">
            {requests.stale
              ? 'The server could not be reached. Your requests are still there.'
              : 'Anything you submit appears here with its status'}
          </span>
        </div>
      ) : (
        rows.map((row) => {
          const style = STATUS_STYLE[row.status];
          // The API joins the decider in; the directory is the fallback for a shape
          // that only carries an id.
          const decider = row.decidedBy ?? people.find((person) => person.id === row.userId);

          return (
            <div className="meeting-row" key={row.id}>
              <span className={`activity-icon ${style.tone}`}>
                <style.icon size={14} />
              </span>

              <div className="meeting-info">
                <strong>
                  {row.type.charAt(0) + row.type.slice(1).toLowerCase()} &bull; {row.days} day
                  {row.days === 1 ? '' : 's'}
                </strong>
                <small>{window_(row)}</small>
                {row.reason && <small className="leave-reason">{row.reason}</small>}
                {decider && (row.status === 'APPROVED' || row.status === 'REJECTED') && (
                  <small>
                    {row.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {decider.name}
                    {row.decidedAt
                      ? ` on ${formatDayLabel(new Date(row.decidedAt))}`
                      : ''}
                  </small>
                )}
                {row.decisionNote && (
                  <small className="leave-reason">Note: {row.decisionNote}</small>
                )}
              </div>

              <span className="chip">{style.label}</span>

              {row.status === 'PENDING' && (
                <button
                  className="icon-btn"
                  type="button"
                  disabled={withdrawing === row.id}
                  onClick={() => withdraw(row.id)}
                  aria-label={`Withdraw your ${row.type.toLowerCase()} request`}
                  title="Withdraw request"
                >
                  <Undo2 size={15} />
                </button>
              )}
            </div>
          );
        })
      )}
    </SectionCard>
  );
}
