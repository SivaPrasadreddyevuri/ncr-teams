'use client';

import { useMemo, useState } from 'react';
import { LogIn, LogOut, Clock3, CheckCircle2, Laptop, PieChart, UserX } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { SectionCard } from '@/components/SectionCard';
import { initials, formatTime, formatDayLabel, localDayKey } from '@/lib/format';
import { attendance as seed, currentUser, directory, type AttendanceRecord } from '@/lib/data';

const STATUSES: Array<{ id: AttendanceRecord['status']; label: string; tone: string; icon: typeof Clock3 }> = [
  { id: 'PRESENT', label: 'Present', tone: 'tone-blue', icon: CheckCircle2 },
  { id: 'LATE', label: 'Late', tone: 'tone-orange', icon: Clock3 },
  { id: 'REMOTE', label: 'Remote', tone: 'tone-purple', icon: Laptop },
  { id: 'HALF_DAY', label: 'Half day', tone: 'tone-pink', icon: PieChart },
  { id: 'ABSENT', label: 'Absent', tone: 'tone-red', icon: UserX },
];

export function AttendanceBoard() {
  const [records, setRecords] = useState<AttendanceRecord[]>(seed);
  const today = localDayKey(new Date());

  const todayRecord = records.find(
    (record) => record.userId === currentUser.id && record.date === today,
  );

  const history = useMemo(
    () =>
      records
        .filter((record) => record.userId === currentUser.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );

  const todayBoard = useMemo(
    () => records.filter((record) => record.date === today),
    [records, today],
  );

  function punchIn() {
    setRecords((current) => [
      ...current.filter(
        (record) => !(record.userId === currentUser.id && record.date === today),
      ),
      {
        id: `at-local-${Date.now()}`,
        userId: currentUser.id,
        date: today,
        checkIn: new Date().toISOString(),
        checkOut: null,
        status: 'PRESENT' as const,
        overtimeMinutes: 0,
      },
    ]);
  }

  function punchOut() {
    setRecords((current) =>
      current.map((record) =>
        record.userId === currentUser.id && record.date === today
          ? { ...record, checkOut: new Date().toISOString() }
          : record,
      ),
    );
  }

  return (
    <div className="grid-2">
      <SectionCard title="My Attendance">
        <div className="profile-facts" style={{ marginBottom: 14 }}>
          <span>Status</span>
          <strong>
            {todayRecord
              ? (STATUSES.find((s) => s.id === todayRecord.status)?.label ?? 'Present')
              : 'Not checked in'}
          </strong>
        </div>

        <div className="profile-facts" style={{ marginBottom: 14 }}>
          <span>Check in</span>
          <strong>{todayRecord?.checkIn ? formatTime(todayRecord.checkIn) : '\u2014'}</strong>
        </div>

        <div className="profile-facts" style={{ marginBottom: 16 }}>
          <span>Check out</span>
          <strong>{todayRecord?.checkOut ? formatTime(todayRecord.checkOut) : '\u2014'}</strong>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="join"
            type="button"
            onClick={punchIn}
            disabled={Boolean(todayRecord?.checkIn)}
          >
            <LogIn size={14} /> Check in
          </button>
          <button
            className="join"
            type="button"
            onClick={punchOut}
            disabled={!todayRecord?.checkIn || Boolean(todayRecord?.checkOut)}
          >
            <LogOut size={14} /> Check out
          </button>
          <small style={{ color: 'var(--muted)' }}>Kept in this session only</small>
        </div>
      </SectionCard>

      <SectionCard title="My History">
        {history.map((record) => {
          const status = STATUSES.find((s) => s.id === record.status);
          return (
            <div className="meeting-row" key={record.id}>
              <span className="time is-date">{formatDayLabel(record.date)}</span>
              <div className="meeting-info">
                <strong>{status?.label ?? record.status}</strong>
                <small>
                  {record.checkIn ? formatTime(record.checkIn) : '\u2014'} &rarr;{' '}
                  {record.checkOut ? formatTime(record.checkOut) : 'in progress'}
                </small>
              </div>
              {record.overtimeMinutes > 0 && (
                <span className="chip active">+{record.overtimeMinutes}m</span>
              )}
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Today's Team">
        <div className="members">
          {directory.map((person) => {
            const record = todayBoard.find((r) => r.userId === person.id);
            return (
              <div className="member" key={person.id}>
                <Avatar initials={initials(person.name)} size="sm" online={person.online} />
                <div>
                  <strong>{person.name}</strong>
                  <small>{record?.checkIn ? `In at ${formatTime(record.checkIn)}` : 'Not checked in'}</small>
                </div>
                {record && <span className="chip active">{record.status.toLowerCase()}</span>}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Legend">
        {STATUSES.map((status) => (
          <div className="meeting-row" key={status.id}>
            <span className={`activity-icon ${status.tone}`}>
              <status.icon size={14} />
            </span>
            <div className="meeting-info">
              <strong>{status.label}</strong>
              <small>
                {todayBoard.filter((r) => r.status === status.id).length} today
              </small>
            </div>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}
