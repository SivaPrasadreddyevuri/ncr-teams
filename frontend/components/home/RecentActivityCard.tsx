'use client';

import { AtSign, CalendarCheck, Clock3, FilePlus2, type LucideIcon } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { relativeTime } from '@/lib/format';
import { activity, type ActivityItem } from '@/lib/data';

const activityIcons: Record<ActivityItem['kind'], LucideIcon> = {
  message: AtSign,
  file: FilePlus2,
  meeting: Clock3,
  leave: CalendarCheck,
};

const tones: Record<ActivityItem['kind'], string> = {
  message: 'tone-blue',
  file: 'tone-purple',
  meeting: 'tone-pink',
  leave: 'tone-orange',
};

/**
 * The activity feed on the dashboard.
 *
 * Leave entries are HR-only: "Leave request pending" reports other people's
 * requests, which an employee has no business seeing. Employees still track their
 * own requests on `/leave`.
 */
export function RecentActivityCard() {
  const { activeUser } = useWorkspace();
  const isHr = activeUser.role === 'HR_ADMIN';

  const items = activity
    .filter((item) => isHr || item.kind !== 'leave')
    .slice(0, 5);

  return (
    <SectionCard title="Recent Activity" href="/activity">
      {items.map((item) => {
        const Icon = activityIcons[item.kind];
        return (
          <div className="activity-row" key={item.id}>
            <span className={`activity-icon ${tones[item.kind]}`}>
              <Icon size={15} />
            </span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </div>
            <small style={{ color: 'var(--muted)' }}>{relativeTime(item.at)}</small>
          </div>
        );
      })}
    </SectionCard>
  );
}
