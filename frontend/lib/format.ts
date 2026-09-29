/**
 * Pure formatting helpers.
 *
 * Deliberately dependency-free: this module is imported by client components,
 * so it must never pull in a server-only package.
 */

/**
 * The workspace timezone, and the single source of truth for it.
 *
 * Nearly every route is prerendered at build time, when the server's own
 * timezone is irrelevant and unknowable to the visitor. So authored wall-clock
 * times -- a 10:00 standup -- are resolved against this zone on both sides,
 * which is what keeps the server HTML and the hydrated client in agreement.
 *
 * Change this one value to retime the whole app. `'Asia/Kolkata'` is a fixed
 * +05:30 with no DST, so wall-clock values round-trip exactly.
 */
export const APP_TIME_ZONE = 'Asia/Kolkata';

/**
 * UTC offset of `APP_TIME_ZONE` in minutes at `date`.
 *
 * Built from `Intl` parts rather than `toLocaleString()`. The latter returns a
 * bare "9/29/2026, 10:00:00" with no zone marker, so feeding it to `new Date()`
 * silently re-interprets it in the *host's* zone. That returns the right offset
 * on a UTC build server and the wrong one (zero, for an IST host) on a
 * developer machine set to the same zone as the app -- the same class of bug as
 * the fixture one below, so it is worth doing properly.
 *
 * Reconstructing the wall clock with `Date.UTC` keeps this independent of the
 * host zone and correct for any DST rule.
 */
function appZoneOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as 24 in some locales; normalise it to 0. The day
  // part is already correct, so this does not roll the date.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return Math.round((asIfUtc - date.getTime()) / 60000);
}

/** Wall-clock parts of `date` as seen in `APP_TIME_ZONE`. */
export function zoneParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as 24 in some locales; normalise it to 0.
  const hour = get('hour') % 24;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
  };
}

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

/**
 * Midnight at the start of `date`'s day in `APP_TIME_ZONE`, returned as an
 * instant. Working in the app zone rather than the host's local zone is what
 * makes the calendar deterministic between a UTC build server and a viewer's
 * browser.
 */
export function startOfAppDay(date: Date): Date {
  const { year, month, day } = zoneParts(date);
  return zoneWallClockToInstant(year, month, day, 0, 0);
}

/** UTC offset of `APP_TIME_ZONE` in milliseconds at `date`. */
export function appZoneOffsetMs(date: Date = new Date()): number {
  return appZoneOffsetMinutes(date) * 60000;
}

/** Wall-clock `hour:minute` in `APP_TIME_ZONE` -> the instant it denotes. */
function zoneWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Approximate the zone's offset at that wall clock, then correct once. One
  // correction is enough because no zone is more than a day from UTC.
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = new Date(guessUtc - appZoneOffsetMinutes(new Date(guessUtc)) * 60000);
  return new Date(guessUtc - appZoneOffsetMinutes(firstPass) * 60000);
}

/** Monday-first sequence of app-zone midnights containing `anchor`. */
export function weekDays(anchor: Date, count = 7): Date[] {
  const { year, month, day } = zoneParts(anchor);
  // Offset from Monday, read from the weekday of that app-zone date.
  const weekday = new Date(
    Date.UTC(year, month - 1, day),
  ).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;

  return Array.from({ length: count }, (_, index) => {
    const midnight = zoneWallClockToInstant(year, month, day - mondayOffset + index, 0, 0);
    return midnight;
  });
}

/** `YYYY-MM-DD` for `date` as seen in `APP_TIME_ZONE`. */
export function appDayKey(date: Date): string {
  const { year, month, day } = zoneParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day of week for `date` in `APP_TIME_ZONE`, 0 = Sunday. */
export function appWeekday(date: Date): number {
  const { year, month, day } = zoneParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Hour of day for `date` in `APP_TIME_ZONE`. */
export function appHour(date: Date): number {
  return zoneParts(date).hour;
}

/**
 * Builds a fixture timestamp whose `APP_TIME_ZONE` clock reads `hour:minute`,
 * `days` days from now.
 *
 * Deliberately resolved against the app zone rather than the host's local zone.
 * `setHours()` reads its argument in whatever timezone the process runs in, so
 * locally (IST) a 10:00 standup stayed 10:00, but on Vercel (UTC) the same call
 * produced 10:00 UTC -- which an Indian browser then rendered as 15:30. The
 * server HTML and the hydrated client disagreed, which is a hydration mismatch
 * and not merely a display shift.
 */
function daysFromNow(days: number, hour: number, minute = 0): string {
  const base = new Date(Date.now() + days * DAY_MS);
  const { year, month, day } = zoneParts(base);
  return zoneWallClockToInstant(year, month, day, hour, minute).toISOString();
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

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: APP_TIME_ZONE,
  });
}

/** Every formatter pins `APP_TIME_ZONE` so both sides read the same clock. */
export function formatTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  });
}

export function formatDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: APP_TIME_ZONE });
}

/** Long form, e.g. "Tuesday, 29 September 2026", in `APP_TIME_ZONE`. */
export function formatLongDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: APP_TIME_ZONE,
  });
}

/** Short day label, e.g. "Wed 30 Sept", in `APP_TIME_ZONE`. */
export function formatDayLabel(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: APP_TIME_ZONE,
  });
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
