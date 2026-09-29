'use client';

import { useState } from 'react';
import { Check, X, Plane } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { SectionCard } from '@/components/SectionCard';
import { formatDate } from '@/lib/format';
import { leaveRequests as seed, type LeaveRequest } from '@/lib/data';

const TONE = { PENDING: 'tone-orange', APPROVED: 'tone-blue', REJECTED: 'tone-pink' } as const;

export function LeaveTable({ currentUserId }: { currentUserId: string }) {
  const [rows, setRows] = useState<LeaveRequest[]>(seed);
  // A leave request can belong to the signed-in user, so the requester name is
  // read from the profile store rather than the static lookup.
  const people = useDirectory();

  function decide(id: string, status: LeaveRequest['status']) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, status, decidedById: currentUserId } : row)),
    );
  }

  return (
    <div className="grid-2">
      <SectionCard title="Leave Requests">
        {rows.map((row) => {
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
          const count = rows.filter((row) => row.status === status).length;
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
