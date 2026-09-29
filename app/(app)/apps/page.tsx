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
import { appCounts } from '@/lib/data';

type App = {
  href: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
  count: number;
};

const APPS: App[] = [
  { href: '/chat', label: 'Chat', detail: 'Channels and direct messages', icon: MessageCircle, tone: 'tone-blue', count: appCounts.channels },
  { href: '/calendar', label: 'Calendar', detail: 'Meetings and events', icon: CalendarDays, tone: 'tone-purple', count: appCounts.events },
  { href: '/files', label: 'Files', detail: 'Shared documents and folders', icon: FolderOpen, tone: 'tone-orange', count: appCounts.files },
  { href: '/meetings', label: 'Meetings', detail: 'Join a room', icon: Video, tone: 'tone-pink', count: appCounts.meetings },
  { href: '/attendance', label: 'Attendance', detail: 'Check in and history', icon: ClipboardCheck, tone: 'tone-blue', count: appCounts.attendance },
];

export default function AppsPage() {
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
            <span className="chip active">{app.count}</span>
            <ArrowRight size={15} style={{ marginLeft: 'auto' }} />
          </div>
        </Link>
      ))}
    </div>
  );
}
