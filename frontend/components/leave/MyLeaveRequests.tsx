'use client';

import { Check, Clock3, X } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { formatDayLabel, formatTime24 } from '@/lib/format';
import type { LeaveRequest } from '@/lib/data';

const STATUS_STYLE: Record<LeaveRequest['status'], { label: string; tone: string; icon: typeof Check }> = {
  PENDING: { label: 'Awaiting HR', tone: 'tone-orange', icon: Clock3 },
  APPROVED: { label: 'Approved', tone: 'tone-blue', icon: Check },
  REJECTED: { label: 'Rejected', tone: 'tone-red', icon: X },
};

/** "Wed 30 Sept, 09:00" — the window a request actually covers. */
function window_(row: LeaveRequest): string {
  const from = new Date(row.from);
  const to = new Date(row.to);

  return `${formatDayLabel(from)}, ${formatTime24(from)} → ${formatDayLabel(to)}, ${formatTime24(to)}`;
}

/**
 * The signed-in person's own requests.
 *
 * An employee can only see their own here, which is the point of keeping this
 * page separate from `/hr`: requesting time off must not require seeing anyone
 * else's.
 */
export function MyLeaveRequests() {
  const { leaveRequests, activeUserId } = useWorkspace();
  // An HR admin also sees the person they approved it as, which is the one bit
  // of context a requester does not have.
  const people = useDirectory();

  const mine = leaveRequests.filter((row) => row.userId === activeUserId);

  return (
    <SectionCard title="My requests">
      {mine.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Clock3 size={22} />
          </span>
          <p>No leave requested yet</p>
          <span className="empty-meta">Anything you submit appears here with its status</span>
        </div>
      ) : (
        mine.map((row) => {
          const style = STATUS_STYLE[row.status];
          const decider = people.find((person) => person.id === row.decidedById);

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
                <small className="leave-reason">{row.reason}</small>
                {decider && (
                  <small>
                    {row.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {decider.name}
                    {row.decidedAt ? ` on ${formatDayLabel(row.decidedAt)}` : ''}
                  </small>
                )}
              </div>

              <span className="chip">{style.label}</span>
            </div>
          );
        })
      )}
    </SectionCard>
  );
}
