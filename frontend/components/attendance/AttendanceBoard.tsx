'use client';

import { useMemo } from 'react';
import { LogIn, LogOut, Clock3, CheckCircle2, Laptop, PieChart, UserX } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { SectionCard } from '@/components/SectionCard';
import { formatTime, formatDayLabel, localDayKey } from '@/lib/format';
import type { AttendanceRecord } from '@/lib/data';

const STATUSES: Array<{ id: AttendanceRecord['status']; label: string; tone: string; icon: typeof Clock3 }> = [
  { id: 'PRESENT', label: 'Present', tone: 'tone-blue', icon: CheckCircle2 },
  { id: 'LATE', label: 'Late', tone: 'tone-orange', icon: Clock3 },
  { id: 'REMOTE', label: 'Remote', tone: 'tone-purple', icon: Laptop },
  { id: 'HALF_DAY', label: 'Half day', tone: 'tone-pink', icon: PieChart },
  { id: 'ABSENT', label: 'Absent', tone: 'tone-red', icon: UserX },
];

/**
 * Where the working day stands, derived rather than tracked.
 *
 * The two buttons used to carry their own `disabled` expressions built from
 * `todayRecord`, which meant the pair could drift out of agreement. A single
 * phase makes them mutually exclusive by construction: exactly one of them is
 * ever actionable, and the reason is one value rather than four boolean terms.
 */
type Phase = 'OUT' | 'IN' | 'DONE';

function phaseOf(record: AttendanceRecord | undefined): Phase {
  if (!record?.checkIn) return 'OUT';
  return record.checkOut ? 'DONE' : 'IN';
}

export function AttendanceBoard() {
  // Read from the store so a check-in survives navigating away and reloading.
  // The records themselves now come from `GET /api/attendance`, and the store
  // reconciles a punch with the server's record once it answers.
  const { attendance, punchIn, punchOut, activeUserId, attendanceError } = useWorkspace();
  const people = useDirectory();
  const today = localDayKey(new Date());

  const todayRecord = useMemo(
    () => attendance.find((record) => record.userId === activeUserId && record.date === today),
    [attendance, activeUserId, today],
  );

  const phase = phaseOf(todayRecord);

  const history = useMemo(
    () =>
      attendance
        .filter((record) => record.userId === activeUserId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [attendance, activeUserId],
  );

  const todayBoard = useMemo(
    () => attendance.filter((record) => record.date === today),
    [attendance, today],
  );

  const status = todayRecord
    ? (STATUSES.find((s) => s.id === todayRecord.status)?.label ?? 'Present')
    : null;

  return (
    <div className="grid-2">
      <SectionCard title="My Attendance">
        {/* Shown only when a punch failed. The times below are still displayed,
            because the local rule computed them and hiding them would look like the
            punch never registered -- but they exist only in this tab, and saying so
            is the honest rendering. */}
        {attendanceError && (
          <p
            style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}
            role="status"
          >
            {attendanceError}
          </p>
        )}
        <div className="profile-facts" style={{ marginBottom: 14 }}>
          <span>Status</span>
          <strong>{status ?? 'Not checked in'}</strong>
        </div>

        <div className="profile-facts" style={{ marginBottom: 14 }}>
          <span>Check in</span>
          <strong>{todayRecord?.checkIn ? formatTime(todayRecord.checkIn) : '—'}</strong>
        </div>

        <div className="profile-facts" style={{ marginBottom: 16 }}>
          <span>Check out</span>
          <strong>
            {todayRecord?.checkOut
              ? formatTime(todayRecord.checkOut)
              : todayRecord?.checkIn
                ? 'in progress'
                : '—'}
          </strong>
        </div>

        <div className="attendance-actions">
          <button
            className="join"
            type="button"
            onClick={punchIn}
            disabled={phase !== 'OUT'}
            title={phase === 'OUT' ? 'Record your arrival' : 'Already checked in today'}
          >
            <LogIn size={14} /> Check in
          </button>

          <button
            className="join"
            type="button"
            onClick={punchOut}
            disabled={phase !== 'IN'}
            title={phase === 'IN' ? 'Record your departure' : 'Check in first'}
          >
            <LogOut size={14} /> Check out
          </button>
        </div>

        <small className="attendance-hint">
          {phase === 'OUT' && 'Checking in records the arrival time only.'}
          {phase === 'IN' && 'Checked in. Checking out will record the departure time.'}
          {phase === 'DONE' && `Completed for today${todayRecord?.overtimeMinutes ? ` · ${todayRecord.overtimeMinutes}m overtime` : ''}.`}
        </small>
      </SectionCard>

      <SectionCard title="My History">
        {history.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Clock3 size={22} />
            </span>
            <p>No attendance recorded</p>
            <span className="empty-meta">Check in to start today's record</span>
          </div>
        ) : (
          history.map((record) => {
            const row = STATUSES.find((s) => s.id === record.status);
            return (
              <div className="meeting-row" key={record.id}>
                <span className="time is-date">{formatDayLabel(record.date)}</span>
                <div className="meeting-info">
                  <strong>{row?.label ?? record.status}</strong>
                  <small>
                    {record.checkIn ? formatTime(record.checkIn) : '—'} &rarr;{' '}
                    {record.checkOut ? formatTime(record.checkOut) : 'in progress'}
                  </small>
                </div>
                {record.overtimeMinutes > 0 && (
                  <span className="chip active">+{record.overtimeMinutes}m</span>
                )}
              </div>
            );
          })
        )}
      </SectionCard>

      <SectionCard title="Today's Team">
        <div className="members">
          {people.map((person) => {
            const record = todayBoard.find((r) => r.userId === person.id);
            const isMe = person.id === activeUserId;

            return (
              <div className="member" key={person.id}>
                <PersonAvatar person={person} size="sm" online={person.online} />
                <div>
                  <strong>
                    {person.name}
                    {isMe && ' (you)'}
                  </strong>
                  <small>
                    {!record?.checkIn
                      ? 'Not checked in'
                      : record.checkOut
                        ? `${formatTime(record.checkIn)} → ${formatTime(record.checkOut)}`
                        : `In at ${formatTime(record.checkIn)}`}
                  </small>
                </div>
                {record && <span className="chip active">{record.status.toLowerCase()}</span>}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Legend">
        {STATUSES.map((row) => (
          <div className="meeting-row" key={row.id}>
            <span className={`activity-icon ${row.tone}`}>
              <row.icon size={14} />
            </span>
            <div className="meeting-info">
              <strong>{row.label}</strong>
              <small>{todayBoard.filter((r) => r.status === row.id).length} today</small>
            </div>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}
