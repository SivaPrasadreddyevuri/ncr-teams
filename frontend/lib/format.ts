/**
 * Pure formatting helpers.
 *
 * Deliberately dependency-free: this module is imported by client components,
 * so it must never pull in a server-only package.
 */

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

/** Initials for an avatar chip, e.g. "Sarah Johnson" -> "SJ". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Local `YYYY-MM-DD`. Avoids toISOString(), which is UTC and shifts days. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Inverse of `localDayKey`.
 *
 * `new Date('2026-09-29')` parses as UTC midnight, which renders as the
 * previous day anywhere west of Greenwich. Splitting the parts and building a
 * local date avoids that off-by-one.
 */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday-first week containing `anchor`. */
export function weekDays(anchor: Date, count = 7): Date[] {
  const day = startOfDay(anchor);
  const offset = (day.getDay() + 6) % 7;
  const monday = new Date(day.getTime() - offset * DAY_MS);
  return Array.from({ length: count }, (_, i) => new Date(monday.getTime() + i * DAY_MS));
}

function daysFromNow(days: number, hour: number, minute = 0): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** "2h ago", "Yesterday", "15 Apr" - compact relative time for feed rows. */
export function relativeTime(input: string | Date, now = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleDateString('en-GB', { dateStyle: 'medium' });
}

export function formatBytes(bytes: number | bigint): string {
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}

/** Recalculate relative mock timestamps so the demo always looks current. */
export function relativeIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export { daysFromNow };
