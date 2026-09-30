/**
 * Post-seed verification.
 *
 * `npm run db:seed` prints row counts, but counts cannot catch the failure mode
 * that actually matters here: a timestamp stored in the right column but resolved
 * against the wrong timezone. Everything below checks *values*, not totals.
 *
 * Run with:  npm run db:verify  (from the repository root)
 */

import '../lib/load-env.js';
import { PrismaClient } from '@prisma/client';
import { APP_TIME_ZONE, appDayKey, zoneParts } from '../lib/app-time.js';

const prisma = new PrismaClient();

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          actual   ${JSON.stringify(actual)}`);
  }
}

/** The `APP_TIME_ZONE` clock reading of an instant, as "HH:mm". */
function wallClock(date: Date): string {
  const { hour, minute } = zoneParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The first element, or a thrown error naming what was missing.
 *
 * `arr[0]!` would satisfy the compiler and hide a genuine empty result, turning
 * a clear "u1 has no attendance rows" into a confusing TypeError three lines
 * later.
 */
function first<T>(items: T[], label: string): T {
  const item = items[0];
  if (item === undefined) throw new Error(`expected at least one ${label}, found none`);
  return item;
}

/** Asserts a nullable column is populated, naming it if it is not. */
function present<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`expected ${label} to be set, but it was null`);
  return value;
}

async function main() {
  console.log(`verifying seed in ${APP_TIME_ZONE}\n`);

  /* --- wall-clock times round-tripped through the app zone, not the host --- */

  const mt1 = await prisma.meeting.findUniqueOrThrow({ where: { id: 'mt1' } });
  check('mt1 Product Team Standup starts at 10:00 app time', wallClock(mt1.startsAt), '10:00');
  check('mt1 ends at 10:30 app time', wallClock(mt1.endsAt), '10:30');

  const mt2 = await prisma.meeting.findUniqueOrThrow({ where: { id: 'mt2' } });
  check('mt2 Design Review starts at 11:30 app time', wallClock(mt2.startsAt), '11:30');

  // e4 is tomorrow at 13:00, so this also proves the day offset landed.
  const e4 = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: 'e4' } });
  check('e4 Marketing Review starts at 13:00 app time', wallClock(e4.startsAt), '13:00');
  const tomorrow = new Date(Date.now() + 86_400_000);
  check('e4 lands on tomorrow in app time', appDayKey(e4.startsAt), appDayKey(tomorrow));

  /* --- leave keeps the time of day, which is why it is not a date column --- */

  const l1 = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: 'l1' } });
  check('l1 spans three days', l1.days, 3);
  check('l1 is ordered', l1.toDate > l1.fromDate, true);
  const l2 = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: 'l2' } });
  check('l2 approved by the HR admin', l2.decidedById, 'u7');
  check('l2 has a decision timestamp', l2.decidedAt !== null, true);

  /* --- attendance: one row per person per day, recent days, closed out --- */

  const attendance = await prisma.attendance.findMany({ orderBy: { id: 'asc' } });
  check('40 attendance rows', attendance.length, 40);

  const keys = new Set(attendance.map((a) => appDayKey(a.date)));
  check('5 distinct attendance days', keys.size, 5);
  check('no attendance row for today', keys.has(appDayKey(new Date())), false);
  check(
    'all seeded days are closed out',
    attendance.every((a) => a.checkIn !== null && a.checkOut !== null),
    true,
  );
  check(
    'check-in precedes check-out everywhere',
    attendance.every((a) => a.checkIn! < a.checkOut!),
    true,
  );

  // One day's worth for u1, whose first row checks in at 08:05 (personIndex 0).
  const u1 = attendance.filter((a) => a.userId === 'u1');
  check('u1 has five days', u1.length, 5);
  const u1First = first(u1, 'attendance row for u1');
  check('u1 first check-in is 08:05 app time', wallClock(present(u1First.checkIn, 'u1 check-in')), '08:05');
  check('u1 first check-out is 18:10 app time', wallClock(present(u1First.checkOut, 'u1 check-out')), '18:10');

  // The (userId, date) unique index is what makes check-in idempotent, so this
  // re-derives the same fact independently rather than trusting the index alone.
  const personDays = new Set(attendance.map((a) => `${a.userId}:${appDayKey(a.date)}`));
  check('no duplicate person-days', attendance.length - personDays.size, 0);

  /* --- messaging --- */

  check('14 messages: 11 channel + 3 meeting', await prisma.message.count(), 14);
  check(
    'every message has a channel or a meeting, never both',
    await prisma.message.count({ where: { NOT: [{ channelId: null }, { meetingId: null }] } }),
    0,
  );
  const m3 = await prisma.message.findUniqueOrThrow({
    where: { id: 'm3' },
    include: { attachments: true },
  });
  check('m3 attaches the design file, not the folder that shares its id', m3.attachments.map((a) => a.id), ['f5']);
  check('reactions are one row per person', await prisma.reaction.count(), 3);

  /* --- unread is derived, so c1 is the only channel with any --- */

  const unread = await prisma.channel.findUniqueOrThrow({
    where: { id: 'c1' },
    include: { states: { where: { userId: 'u1' } }, messages: { orderBy: { createdAt: 'desc' } } },
  });
  const marker = present(first(unread.states, 'read state for c1').lastReadAt, 'c1 read marker');
  check(
    'c1 shows two unread messages for u1',
    unread.messages.filter((m) => m.createdAt > marker).length,
    2,
  );

  /* --- files --- */

  check('nine file rows', await prisma.file.count(), 9);
  const folders = await prisma.file.count({ where: { isFolder: true } });
  check('three of them are folders', folders, 3);
  check(
    'folders hold no bytes',
    await prisma.file.count({ where: { isFolder: true, NOT: { sizeBytes: 0n } } }),
    0,
  );
  const f5 = await prisma.file.findUniqueOrThrow({
    where: { id: 'f5' },
    include: { starredBy: true },
  });
  check('f5 is starred by u1 only', f5.starredBy.map((u) => u.id), ['u1']);

  // sizeBytes is BigInt, which throws on JSON.stringify. If an API ever forgets
  // to convert it, the response dies at serialisation time, so assert here.
  check('sizeBytes survives a JSON round-trip', Number(f5.sizeBytes), 4_400_000);
  const serialised = (() => {
    try {
      JSON.stringify(f5);
      return 'ok';
    } catch (error) {
      return error instanceof Error ? error.name : 'threw';
    }
  })();
  check('serialising a raw File throws, as documented', serialised, 'TypeError');

  /* --- people --- */

  check('eight users', await prisma.user.count(), 8);
  check('one HR admin', await prisma.user.count({ where: { role: 'HR_ADMIN' } }), 1);
  check('the HR admin is u7, not the signed-in user', (await prisma.user.findUniqueOrThrow({ where: { id: 'u7' } })).role, 'HR_ADMIN');
  check('u1 is an ordinary employee', (await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).role, 'EMPLOYEE');
  check('six departments, each with a head', await prisma.department.count({ where: { headId: { not: null } } }), 6);
  check('every user belongs to a department', await prisma.user.count({ where: { departmentId: null } }), 0);

  /* --- memberships --- */

  check('u1 is in t1 as OWNER', (await prisma.teamMember.findUniqueOrThrow({ where: { userId_teamId: { userId: 'u1', teamId: 't1' } } })).role, 'OWNER');
  check('u1 is in t2 although the fixture memberIds omit them', await prisma.teamMember.count({ where: { userId: 'u1', teamId: 't2' } }), 1);
  check('u1 is not in t5, which is marked mine: false', await prisma.teamMember.count({ where: { userId: 'u1', teamId: 't5' } }), 0);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
