'use client';

import { AtSign, CalendarCheck, Clock3, FilePlus2, type LucideIcon } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { relativeTime } from '@/lib/format';
import { api, composeActivity, type ActivityRow } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { activity as seedActivity, type ActivityItem } from '@/lib/data';

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

/** A feed row reduced to what this card renders. Both sources become this. */
type FeedItem = {
  id: string;
  kind: ActivityItem['kind'];
  title: string;
  subtitle: string;
  at: string;
};

/**
 * A live row, with the sentence composed.
 *
 * Composed here rather than in the render because the fixture rows have no
 * structured target to compose from -- they only ever had the frozen string. Doing
 * it in the fetcher is what lets both sources be the same type, so the component
 * below cannot tell them apart and there is no "if live then" branch to get wrong.
 */
function fromApi(row: ActivityRow): FeedItem {
  const sentence = composeActivity(row);
  return {
    id: row.id,
    kind: row.kind,
    title: sentence.title,
    subtitle: sentence.subtitle,
    at: row.createdAt,
  };
}

/** A fixture row, passed through: its title is already a sentence. */
function fromSeed(item: ActivityItem): FeedItem {
  return { id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, at: item.at };
}

/**
 * The activity feed on the dashboard.
 *
 * Live, through `useApiData` like the other dashboard cards, so it cannot disagree
 * with `/activity`. That was the reason to do it: both screens render "Recent
 * Activity", and a fixture on one and live rows on the other is a discrepancy a
 * viewer can see by clicking.
 *
 * Leave entries are filtered for non-HR. The API scopes the feed to the caller's
 * own notifications, but the seed can place a notification about someone *else's*
 * request in that feed, and "Leave request pending" naming a colleague is not an
 * employee's business. Employees track their own requests on `/leave`.
 */
export function RecentActivityCard() {
  const { activeUser } = useWorkspace();
  const isHr = activeUser.role === 'HR_ADMIN';

  const { data, stale } = useApiData<FeedItem[]>(
    'activity:recent',
    (signal) => api.activity(10, undefined, signal).then((r) => r.activity.map(fromApi)),
    // The seed, so the card renders immediately and never flashes empty.
    seedActivity.map(fromSeed),
  );

  const items = data.filter((item) => isHr || item.kind !== 'leave').slice(0, 5);

  return (
    <SectionCard title="Recent Activity" href="/activity">
      {stale && (
        // A cache or fixture hit looks exactly like a live one unless something
        // says otherwise. `useApiData` exposes `stale` precisely for this.
        <small style={{ color: 'var(--muted)' }}>Showing the last known activity</small>
      )}
      {items.map((item) => {
        const Icon = activityIcons[item.kind];
        return (
          <div className="activity-row" key={item.id}>
            <span className={`activity-icon ${tones[item.kind]}`}>
              <Icon size={15} />
            </span>
            <div>
              <strong>{item.title}</strong>
              {item.subtitle && <small>{item.subtitle}</small>}
            </div>
            <small style={{ color: 'var(--muted)' }}>{relativeTime(item.at)}</small>
          </div>
        );
      })}
    </SectionCard>
  );
}
