/**
 * App-time helpers for the seed.
 *
 * Deliberately a copy of the logic in `frontend/lib/format.ts` rather than an
 * import: the frontend module is bundled for the browser, and this workspace
 * must not depend on the frontend's build output. The two are pinned to the
 * same zone constant, so if `APP_TIME_ZONE` ever changes, change it in both.
 *
 * The rule being enforced: an authored wall-clock time like "10:00 standup" is
 * resolved against the app zone, never the host's local zone. `setHours()` reads
 * its argument in the *process* timezone, so on a UTC host a 10:00 standup would
 * become 10:00 UTC and render as 15:30 to a viewer in India.
 */

/** The workspace timezone. A fixed +05:30 with no DST, so wall clocks round-trip. */
export const APP_TIME_ZONE = 'Asia/Kolkata';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** UTC offset of `APP_TIME_ZONE` at `date`, in minutes. */
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
  // Intl renders midnight as 24 in some locales; normalise to 0.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return Math.round((asIfUtc - date.getTime()) / MINUTE);
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

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

/** Wall-clock `hour:minute` in `APP_TIME_ZONE` -> the instant it denotes. */
function zoneWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Approximate the offset at that wall clock, then correct once. One pass is
  // enough because no zone is more than a day from UTC.
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = new Date(guessUtc - appZoneOffsetMinutes(new Date(guessUtc)) * MINUTE);
  return new Date(guessUtc - appZoneOffsetMinutes(firstPass) * MINUTE);
}

/** An instant `minutes` in the past. Matches `relativeIso` in the frontend. */
export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

/** An instant `days` from now whose `APP_TIME_ZONE` clock reads `hour:minute`. */
export function daysFromNow(days: number, hour: number, minute = 0): Date {
  const base = new Date(Date.now() + days * DAY);
  const { year, month, day } = zoneParts(base);
  return zoneWallClockToInstant(year, month, day, hour, minute);
}

/** `YYYY-MM-DD` for the app-zone day containing `date`. */
export function appDayKey(date: Date): string {
  const { year, month, day } = zoneParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The app-zone day `offset` days from today, as a `Date` at local midnight. */
function appDayAtMidnight(offset: number): Date {
  const { year, month, day } = zoneParts(new Date(Date.now() + offset * DAY));
  return new Date(year, month - 1, day);
}

/**
 * Wall-clock time on an app-zone day, as an instant.
 *
 * The attendance fixtures are authored as bare `YYYY-MM-DDTHH:mm:ss` strings,
 * which JavaScript parses in the *host's* zone. Storing those verbatim would make
 * the seeded clock depend on where the seed ran. This resolves the same wall
 * clock against the app zone instead, so the demo reads 08:05 whether the seed
 * ran on this machine or on a UTC CI runner.
 */
export function wallClockOnDay(offset: number, hour: number, minute: number): {
  date: Date;
  dayKey: string;
} {
  const { year, month, day } = zoneParts(appDayAtMidnight(offset));
  return {
    date: zoneWallClockToInstant(year, month, day, hour, minute),
    dayKey: appDayKey(appDayAtMidnight(offset)),
  };
}

/** Calendar year in `APP_TIME_ZONE`, for `LeaveBalance.year`. */
export function appYear(): number {
  return zoneParts(new Date()).year;
}
