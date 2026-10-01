'use client';

import { CalendarDays, FileText, MessageCircle, UsersRound } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { api } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { dashboardStats } from '@/lib/data';

/**
 * The fixture counts, as the seed value for `useApiData`.
 *
 * The fixture's `pendingRequests` is not used anywhere -- `HomeStats` derives the
 * pending count from the leave requests themselves, because leave has no endpoint
 * yet. It is left out here for the same reason: a number on this card should come
 * from the endpoint that will own it, not from a fixture that already has a live
 * counterpart.
 */
const seed = {
  messages: dashboardStats.messages,
  meetings: dashboardStats.meetings,
  mentions: dashboardStats.mentions,
};

/**
 * The dashboard stat cards.
 *
 * Live now. It was the last card on the home page reading a fixture, which meant
 * the page mixed real and invented numbers -- a dashboard whose "New messages" was
 * a hardcoded 8 next to a live activity feed.
 *
 * "Pending requests" stays on the leave requests and stays hidden from employees,
 * because leave has no endpoint yet. It is not replaced with a count from
 * `/api/stats` that nothing else reads.
 *
 * "New messages" is unread, against each channel's own read marker -- so it cannot
 * disagree with the sidebar badge.
 */
export function HomeStats() {
  const { leaveRequests, activeUser } = useWorkspace();
  const isHr = activeUser.role === 'HR_ADMIN';

  const pending = leaveRequests.filter((row) => row.status === 'PENDING').length;

  const { data, stale } = useApiData(
    'stats:dashboard',
    (signal) => api.stats(signal).then((r) => r.dashboard),
    seed,
  );

  return (
    <div className="stats">
      <StatCard
        label="New messages"
        value={String(data.messages)}
        icon={MessageCircle}
        tone="tone-blue"
      />
      <StatCard
        label="Upcoming meetings"
        value={String(data.meetings)}
        icon={CalendarDays}
        tone="tone-purple"
      />
      {isHr && (
        <StatCard
          label="Pending requests"
          value={String(pending)}
          icon={FileText}
          tone="tone-pink"
        />
      )}
      <StatCard
        label="Team mentions"
        value={String(data.mentions)}
        icon={UsersRound}
        tone="tone-orange"
      />
      {stale && (
        // A cache or fixture hit looks exactly like a live one unless something says
        // otherwise, and a dashboard is exactly the place a stale number reads as
        // a real one.
        <small style={{ color: 'var(--muted)' }}>Showing the last known counts</small>
      )}
    </div>
  );
}
