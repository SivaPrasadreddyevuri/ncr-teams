'use client';

import Link from 'next/link';
import {
  MessageCircle,
  CalendarDays,
  FolderOpen,
  Video,
  ClipboardCheck,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { appCounts } from '@/lib/data';

type App = {
  href: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
  /**
   * Which field of the API's `apps` block this badge reads, rather than a number.
   *
   * Declaring the key rather than the value is what lets the seed below be a plain
   * object literal -- the fixture counts and the live counts stay the same shape,
   * and adding a sixth app is a one-line change here instead of a second literal to
   * keep in step.
   */
  countKey: keyof Awaited<ReturnType<typeof api.stats>>['apps'];
};

const APPS: App[] = [
  { href: '/chat', label: 'Chat', detail: 'Channels and direct messages', icon: MessageCircle, tone: 'tone-blue', countKey: 'channels' },
  { href: '/calendar', label: 'Calendar', detail: 'Meetings and events', icon: CalendarDays, tone: 'tone-purple', countKey: 'events' },
  { href: '/files', label: 'Files', detail: 'Shared documents and folders', icon: FolderOpen, tone: 'tone-orange', countKey: 'files' },
  { href: '/meetings', label: 'Meetings', detail: 'Join a room', icon: Video, tone: 'tone-pink', countKey: 'meetings' },
  { href: '/attendance', label: 'Attendance', detail: 'Check in and history', icon: ClipboardCheck, tone: 'tone-blue', countKey: 'attendance' },
];

/**
 * The apps launcher.
 *
 * A client component because the counts need the session cookie -- see the note on
 * `request` in `lib/api.ts`, where a server component doing this hangs rather than
 * failing.
 *
 * These badges were `appCounts.length` calls in the browser, which is how a
 * launcher ended up claiming a number that had nothing to do with the database.
 */
export function AppsScreen() {
  const { data } = useApiData(
    'stats:apps',
    (signal) => api.stats(signal).then((r) => r.apps),
    appCounts,
  );

  return (
    <div className="cards-grid">
      {APPS.map((app) => (
        <Link className="team-card" href={app.href} key={app.href}>
          <div className="team-icon">
            <app.icon size={20} />
          </div>
          <h3>{app.label}</h3>
          <p>{app.detail}</p>
          <div className="members-line" style={{ display: 'flex', alignItems: 'center' }}>
            <span className="chip active">{data[app.countKey]}</span>
            <ArrowRight size={15} style={{ marginLeft: 'auto' }} />
          </div>
        </Link>
      ))}
    </div>
  );
}
