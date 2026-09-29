'use client';

import { useMemo, useState } from 'react';
import { Plane, Send } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { LEAVE_TYPES, type LeaveRequest } from '@/lib/data';
import { fromAppInputValue, toAppInputValue } from '@/lib/format';

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Annual leave',
  SICK: 'Sick leave',
  PERSONAL: 'Personal day',
  PARENTAL: 'Parental leave',
  UNPAID: 'Unpaid leave',
};

/** Longest single request, to stop someone booking a year off by accident. */
const MAX_DAYS = 30;

type Errors = Partial<Record<'from' | 'to' | 'reason', string>>;

/** Wall-clock days a window covers, counting the end day inclusively. */
function spanInDays(from: Date, to: Date): number {
  const DAY = 86_400_000;
  return Math.floor((to.getTime() - from.getTime()) / DAY) + 1;
}

export function LeaveRequestForm() {
  const { addLeave, leaveRequests, activeUserId } = useWorkspace();

  // Default to a sensible window rather than an empty form: 09:00 today through
  // 17:00 tomorrow, in the workspace's own timezone.
  const [type, setType] = useState<string>('ANNUAL');
  const [from, setFrom] = useState(() => {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    return toAppInputValue(start);
  });
  const [to, setTo] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(17, 0, 0, 0);
    return toAppInputValue(end);
  });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string | null>(null);

  // A second request covering time already booked, pending or approved, is
  // almost always a mistake. Rejected requests do not block a new one.
  const committed = useMemo(
    () =>
      leaveRequests.filter(
        (row) =>
          row.userId === activeUserId && (row.status === 'PENDING' || row.status === 'APPROVED'),
      ),
    [leaveRequests, activeUserId],
  );

  function validate(): { request: LeaveRequest | null; errors: Errors } {
    const next: Errors = {};

    const start = fromAppInputValue(from);
    const end = fromAppInputValue(to);

    if (!start) next.from = 'Enter a valid start date and time.';
    if (!end) next.to = 'Enter a valid end date and time.';

    if (start && end) {
      if (end.getTime() <= start.getTime()) {
        next.to = 'The end must come after the start.';
      } else if (spanInDays(start, end) > MAX_DAYS) {
        next.to = `A single request cannot be longer than ${MAX_DAYS} days.`;
      } else {
        const clashes = committed.find((row) => {
          const rowStart = new Date(row.from).getTime();
          const rowEnd = new Date(row.to).getTime();
          return start.getTime() <= rowEnd && end.getTime() >= rowStart;
        });

        if (clashes) {
          next.to =
            clashes.status === 'APPROVED'
              ? 'These dates overlap leave you already have approved.'
              : 'These dates overlap a request you already have pending.';
        }
      }
    }

    if (!reason.trim()) next.reason = 'Give a reason so HR can decide.';

    if (Object.keys(next).length > 0 || !start || !end) return { request: null, errors: next };

    return {
      request: {
        id: `l-${activeUserId}-${Date.now()}`,
        userId: activeUserId,
        type,
        from: start.toISOString(),
        to: end.toISOString(),
        days: spanInDays(start, end),
        reason: reason.trim(),
        status: 'PENDING',
        decidedById: null,
      },
      errors: {},
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    const { request, errors: found } = validate();
    setErrors(found);

    if (!request) return;

    addLeave(request);
    setReason('');
    setNotice('Request submitted. It is now waiting for HR to decide.');
  }

  return (
    <SectionCard title="Request leave">
      <form onSubmit={submit} noValidate>
        <div className="form-field">
          <label htmlFor="leave-type">Type of leave</label>
          <select
            id="leave-type"
            className="table-input"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {LEAVE_TYPES.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABEL[option] ?? option}
              </option>
            ))}
          </select>
        </div>

        <div className="leave-window">
          <div className="form-field">
            <label htmlFor="leave-from">From</label>
            <input
              id="leave-from"
              type="datetime-local"
              className="table-input"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-invalid={Boolean(errors.from)}
              aria-describedby={errors.from ? 'leave-from-error' : undefined}
            />
            {errors.from && (
              <small className="form-error" id="leave-from-error">
                {errors.from}
              </small>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="leave-to">To</label>
            <input
              id="leave-to"
              type="datetime-local"
              className="table-input"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={Boolean(errors.to)}
              aria-describedby={errors.to ? 'leave-to-error' : undefined}
            />
            {errors.to && (
              <small className="form-error" id="leave-to-error">
                {errors.to}
              </small>
            )}
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="leave-reason">Reason</label>
          <textarea
            id="leave-reason"
            className="table-input"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Family trip, medical appointment, and so on"
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={errors.reason ? 'leave-reason-error' : undefined}
          />
          {errors.reason && (
            <small className="form-error" id="leave-reason-error">
              {errors.reason}
            </small>
          )}
        </div>

        <div className="leave-submit">
          <button className="join" type="submit">
            <Send size={14} /> Submit request
          </button>
          <small style={{ color: 'var(--muted)' }}>
            <Plane size={12} /> Times are in the workspace timezone
          </small>
        </div>

        <p className="leave-notice" role="status" aria-live="polite">
          {notice ?? ''}
        </p>
      </form>
    </SectionCard>
  );
}
