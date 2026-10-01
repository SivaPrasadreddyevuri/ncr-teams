/**
 * App-time helpers for the API.
 *
 * ## A third copy of this logic, deliberately
 *
 * The same zone constant and day-key logic already exist in
 * `database/lib/app-time.ts` and `frontend/lib/format.ts`, and this is the third
 * copy. It is not an import because all three are separate npm workspaces with
 * their own `tsconfig` and their own `rootDir` for the build -- a cross-workspace
 * import either fails to typecheck or emits files outside `dist`. The frontend copy
 * is bundled for the browser, so the database cannot depend on it either.
 *
 * If `APP_TIME_ZONE` ever changes, change it in all three. The drift this risks is
 * guarded where it would actually bite: `appDayKey` has a test asserting a known
 * UTC instant maps to the expected app-zone date, so a wrong offset or a wrong
 * zone is caught even though a *mismatch between files* is not.
 *
 * ## Why the API needs it
 *
 * `Attendance.date` is a `date` column, and an attendance day is calendar-local --
 * see the comment on the column in `prisma/schema.prisma`. So "what day is it" has
 * to be answered in the workspace's timezone.
 *
 * Getting that wrong is not subtle but it is easy: Render runs in UTC, so
 * `new Date().toISOString().slice(0, 10)` would file a 02:00 IST punch-in under the
 * previous day for six and a half hours out of every twenty-four. The punch route
 * uses `appDayKey` for exactly this reason.
 */

/** The workspace timezone. A fixed +05:30 with no DST, so wall clocks round-trip. */
export const APP_TIME_ZONE = 'Asia/Kolkata';

/** Wall-clock parts of `date` as seen in `APP_TIME_ZONE`. */
export function zoneParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
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
    // Intl renders midnight as 24 in some locales; normalise to 0.
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

/** `YYYY-MM-DD` for the app-zone day containing `date`. */
export function appDayKey(date: Date): string {
  const { year, month, day } = zoneParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Minutes past midnight in `APP_TIME_ZONE`, for the late and overtime rules. */
export function appMinutesOfDay(date: Date): number {
  const { hour, minute } = zoneParts(date);
  return hour * 60 + minute;
}

/**
 * `YYYY-MM-DD` to the `Date` a `@db.Date` column round-trips through.
 *
 * Prisma reads a Postgres `date` as a `Date` at UTC midnight, and the column is
 * stored as whatever `toISOString().slice(0, 10)` gives. So the key is reconstructed
 * rather than formatted from a local zone -- using `toLocaleDateString` here would
 * shift every record by a day for anyone west of UTC.
 */
export function dateColumnToDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}
