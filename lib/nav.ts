import {
  Home,
  Activity,
  MessageCircle,
  Users,
  CalendarDays,
  Phone,
  FolderOpen,
  ClipboardCheck,
  BriefcaseBusiness,
  Search,
  Grid2X2,
  Settings,
  Radio,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  /** Shown in the topbar. */
  title: string;
  icon: LucideIcon;
  /** Unread count rendered as a pill in the sidebar. */
  badge?: number;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', title: 'Dashboard / Home', icon: Home },
  { href: '/activity', label: 'Activity', title: 'Activity', icon: Activity, badge: 1 },
  { href: '/chat', label: 'Chat', title: 'Chat', icon: MessageCircle },
  { href: '/channels', label: 'Channels', title: 'Channels', icon: Radio },
  { href: '/teams', label: 'Teams', title: 'Teams', icon: Users },
  { href: '/calendar', label: 'Calendar', title: 'Calendar', icon: CalendarDays },
  { href: '/calls', label: 'Calls', title: 'Calls', icon: Phone },
  { href: '/files', label: 'Files', title: 'Files', icon: FolderOpen },
  { href: '/attendance', label: 'Attendance', title: 'Attendance', icon: ClipboardCheck },
  { href: '/hr', label: 'HR', title: 'HR', icon: BriefcaseBusiness },
  { href: '/search', label: 'Search', title: 'Search', icon: Search },
  { href: '/apps', label: 'Apps', title: 'Apps', icon: Grid2X2 },
  { href: '/settings', label: 'Settings', title: 'Settings', icon: Settings },
];

/**
 * Routes that have no sidebar entry but still need a topbar title.
 * The reference keeps Meetings out of the nav -- you reach a room from Home or
 * Activity -- so it is resolved separately rather than by adding a nav item.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/meetings': 'Meetings',
  '/channels': 'Channels',
  '/verify-2fa': 'Security',
};

/** Page title for a pathname, falling back to the product name. */
export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.find(
    (item) => item.href === pathname || (item.href !== '/' && pathname.startsWith(`${item.href}/`)),
  );
  if (match) return match.title;

  const extra = Object.entries(EXTRA_TITLES).find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`),
  );
  return extra?.[1] ?? 'NCR Teams';
}

/** True when `href` should render as the active nav entry. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}
