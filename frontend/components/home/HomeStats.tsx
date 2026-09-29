'use client';

import { CalendarDays, FileText, MessageCircle, UsersRound } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { dashboardStats } from '@/lib/data';

/**
 * The dashboard stat cards.
 *
 * "Pending requests" counts leave requests awaiting a decision, which is an HR
 * concern, so it is hidden from employees and the count comes from the store
 * rather than a hardcoded fixture number. Everything else is workspace-wide.
 */
export function HomeStats() {
  const { leaveRequests, activeUser } = useWorkspace();

  const isHr = activeUser.role === 'HR_ADMIN';
  const pending = leaveRequests.filter((row) => row.status === 'PENDING').length;

  return (
    <div className="stats">
      <StatCard
        label="New messages"
        value={String(dashboardStats.messages)}
        icon={MessageCircle}
        tone="tone-blue"
      />
      <StatCard
        label="Upcoming meetings"
        value={String(dashboardStats.meetings)}
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
        value={String(dashboardStats.mentions)}
        icon={UsersRound}
        tone="tone-orange"
      />
    </div>
  );
}
