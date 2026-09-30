/**
 * Demo seed.
 *
 * The single source of truth for this file is `frontend/lib/data.ts`. Every id,
 * name and timestamp below is transcribed from those fixtures so that the day the
 * frontend is switched over to the API, the screens render the same content.
 * Where the two cannot both be satisfied, the difference is called out inline.
 *
 * Everything is derived from `Date.now()`, so the demo always looks current
 * rather than rotting around a fixed 2025 date.
 *
 * Idempotent by truncation, not by upsert. `prisma migrate reset` calls this on
 * an empty schema, and re-seeding should be a full replace -- partial upserts
 * leave orphaned rows behind, which is how demo data quietly diverges from the
 * fixtures it claims to mirror. A guard refuses to truncate a populated
 * database unless `SEED_ALLOW_WIPE=true`, so this cannot eat real data by
 * accident.
 */

import '../lib/load-env.js';
import { PrismaClient, type Prisma } from '@prisma/client';
import { appDayKey, appYear, daysFromNow, minutesAgo, wallClockOnDay } from '../lib/app-time.js';

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

// `avatarUrl` is omitted throughout: the fixtures deliberately leave it
// optional, set only for the signed-in person at runtime by a photo upload.
// `online` has no column -- presence is live WebSocket state, not a persisted
// flag, so persisting it would go stale the moment anyone closed a tab.

const users = [
  { id: 'u1', name: 'Alex Johnson',   email: 'alex@company.com',   jobTitle: 'Product Manager',       employeeCode: 'EMP-1001', role: 'EMPLOYEE',  departmentId: 'd2', phone: '+1 555 0100', bio: 'Product manager focused on the collaboration platform.' },
  { id: 'u2', name: 'Sarah Johnson',  email: 'sarah@company.com',  jobTitle: 'Engineering Manager',   employeeCode: 'EMP-1002', role: 'MANAGER',   departmentId: 'd1', phone: '+1 555 0101', bio: 'Leads the platform engineering team.' },
  { id: 'u3', name: 'Emma Davis',     email: 'emma@company.com',   jobTitle: 'Senior Product Designer', employeeCode: 'EMP-1003', role: 'EMPLOYEE', departmentId: 'd3', phone: '+1 555 0102', bio: 'Designs the dashboard and settings surfaces.' },
  { id: 'u4', name: 'Michael Chen',   email: 'michael@company.com', jobTitle: 'Staff Engineer',       employeeCode: 'EMP-1004', role: 'EMPLOYEE',  departmentId: 'd1', phone: '+1 555 0103', bio: 'Backend and data infrastructure.' },
  { id: 'u5', name: 'James Wilson',   email: 'james@company.com',   jobTitle: 'Backend Engineer',      employeeCode: 'EMP-1005', role: 'EMPLOYEE',  departmentId: 'd1', phone: '+1 555 0104', bio: 'APIs and integrations.' },
  { id: 'u6', name: 'Emily Davis',    email: 'emily@company.com',  jobTitle: 'Marketing Specialist',  employeeCode: 'EMP-1006', role: 'EMPLOYEE',  departmentId: 'd4', phone: '+1 555 0105', bio: 'Campaigns and go-to-market.' },
  { id: 'u7', name: 'Priya Nair',     email: 'priya@company.com',   jobTitle: 'Head of People',        employeeCode: 'EMP-1007', role: 'HR_ADMIN',  departmentId: 'd5', phone: '+1 555 0106', bio: 'HR, hiring and workplace operations.' },
  { id: 'u8', name: 'Tom Baker',      email: 'tom@company.com',     jobTitle: 'Sales Lead',            employeeCode: 'EMP-1008', role: 'MANAGER',   departmentId: 'd6', phone: '+1 555 0107', bio: 'Revenue and customer success.' },
] as const;

const ALL_USER_IDS = users.map((u) => u.id);

// `head` is a person's *name* in the fixtures; the schema wants an id.
const departments = [
  { id: 'd1', name: 'Engineering', description: 'Product engineering and platform',           headId: 'u2' },
  { id: 'd2', name: 'Product',     description: 'Product management',                          headId: 'u1' },
  { id: 'd3', name: 'Design',      description: 'Brand, product design and research',          headId: 'u3' },
  { id: 'd4', name: 'Marketing',   description: 'Demand generation and communications',       headId: 'u6' },
  { id: 'd5', name: 'People',      description: 'HR, hiring and workplace operations',         headId: 'u7' },
  { id: 'd6', name: 'Sales',       description: 'Revenue and customer success',                headId: 'u8' },
];

/* ------------------------------------------------------------------ */
/* Teams and channels                                                  */
/* ------------------------------------------------------------------ */

const teams = [
  { id: 't1', name: 'Product Team', description: 'Product development and collaboration', memberIds: ['u1', 'u2', 'u3'], mine: true,  myRole: 'OWNER' as const },
  { id: 't2', name: 'Engineering',  description: 'Build and maintain the platform',             memberIds: ['u2', 'u4', 'u5'], mine: true,  myRole: 'MEMBER' as const },
  { id: 't3', name: 'Design Team',  description: 'Product design and design system',            memberIds: ['u3'],             mine: true,  myRole: 'OWNER' as const },
  { id: 't4', name: 'Marketing',    description: 'Campaigns and go-to-market',                  memberIds: ['u6'],             mine: false, myRole: null },
  { id: 't5', name: 'HR',           description: 'People operations',                           memberIds: ['u7'],             mine: false, myRole: null },
  { id: 't6', name: 'Operations',   description: 'Internal operations',                         memberIds: [],                mine: false, myRole: null },
  { id: 't7', name: 'Sales',        description: 'Pipeline and customers',                      memberIds: ['u7', 'u8'],       mine: false, myRole: null },
  { id: 't8', name: 'General',      description: 'Company-wide announcements',                  memberIds: ALL_USER_IDS,      mine: true,  myRole: 'MEMBER' as const },
];

// `lastMessage`, `lastAt` and `unread` are not columns. `lastMessage`/`lastAt` are
// a join against the newest row in Message; `unread` is a count derived from
// ChannelReadState. Persisting them would mean three more columns to keep
// consistent with the messages they summarise, for data that is one query away.
const channels = [
  { id: 'c1',  name: 'general',         teamId: 't1' },
  { id: 'c2',  name: 'product-updates', teamId: 't1' },
  { id: 'c3',  name: 'design-review',   teamId: 't1' },
  { id: 'c4',  name: 'roadmap',         teamId: 't1' },
  { id: 'c5',  name: 'general',         teamId: 't2' },
  { id: 'c6',  name: 'backend',         teamId: 't2' },
  { id: 'c7',  name: 'incidents',       teamId: 't2' },
  { id: 'c8',  name: 'critique',        teamId: 't3' },
  { id: 'c9',  name: 'general',         teamId: 't8' },
  { id: 'c10', name: 'random',          teamId: 't8' },
];

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

// 11 channel messages plus 3 meeting messages: 14 Message rows in total.
const messages = [
  { id: 'm1',  channelId: 'c1',  userId: 'u2', body: 'Hey team, standup notes are up.',                                    at: 240 },
  { id: 'm2',  channelId: 'c1',  userId: 'u1', body: "I'll review the dashboard design this morning.",                     at: 232 },
  { id: 'm3',  channelId: 'c1',  userId: 'u3', body: "Here's the updated dashboard design for the dashboard.",               at: 150 },
  { id: 'm4',  channelId: 'c1',  userId: 'u1', body: 'Looks great. The new navigation and activity cards are in there too.', at: 148 },
  { id: 'm5',  channelId: 'c1',  userId: 'u2', body: 'Perfect! I will prepare the review.',                                 at: 141 },
  { id: 'm6',  channelId: 'c1',  userId: 'u3', body: 'Perfect, I will prepare the review.',                                 at: 120 },
  { id: 'm7',  channelId: 'c2',  userId: 'u1', body: 'Shipping the Q2 roadmap on Friday.',                                 at: 90 },
  { id: 'm8',  channelId: 'c5',  userId: 'u4', body: 'Deploy to staging is green.',                                         at: 200 },
  { id: 'm9',  channelId: 'c5',  userId: 'u5', body: 'Nice. Running the migration dry run now.',                           at: 180 },
  { id: 'm10', channelId: 'c8',  userId: 'u3', body: 'Critique doc for the settings page is ready.',                        at: 60 },
  { id: 'm11', channelId: 'c9',  userId: 'u1', body: 'Welcome to everyone joining this week.',                             at: 1440 },
] as const;

const meetingMessages = [
  { id: 'mm1', meetingId: 'mt1', userId: 'u2', body: "Let's review the latest dashboard design.", at: 300 },
  { id: 'mm2', meetingId: 'mt3', userId: 'u4', body: 'Staging is green, ready for review.',       at: 200 },
  { id: 'mm3', meetingId: 'mt5', userId: 'u7', body: 'Agenda is in the channel.',               at: 400 },
] as const;

// One row per (message, emoji, user). The fixtures group these as
// `{ emoji, userIds }`, which is a read shape, not a write shape.
const reactions = [
  { id: 'r1', messageId: 'm3', emoji: '👍', userId: 'u2' },
  { id: 'r2', messageId: 'm3', emoji: '👍', userId: 'u4' },
  { id: 'r3', messageId: 'm7', emoji: '🎉', userId: 'u3' },
];

/* ------------------------------------------------------------------ */
/* Meetings and calendar                                               */
/* ------------------------------------------------------------------ */

/**
 * `[dayOffset, hour, minute?]` -- a wall-clock time relative to today.
 *
 * Typed explicitly because the fixtures write a bare literal, and TypeScript
 * infers a differently-shaped tuple per entry (`[0, 10]` is length two,
 * `[0, 11, 30]` is length three). Without a common type, every element access
 * widens to `number | undefined` and the `?? 0` defaults are no longer
 * provably safe.
 */
type Window = [number, number] | [number, number, number];

/** Resolves a `Window` to an instant whose app-zone clock reads that time. */
function at(w: Window): Date {
  return daysFromNow(w[0], w[1], w[2] ?? 0);
}

const meetings: Array<{
  id: string;
  title: string;
  roomName: string;
  organizerId: string;
  start: Window;
  end: Window;
  participantIds: readonly string[];
}> = [
  { id: 'mt1', title: 'Product Team Standup', roomName: 'room-product-standup', organizerId: 'u1', start: [0, 10],    end: [0, 10, 30], participantIds: ['u1', 'u2', 'u3'] },
  { id: 'mt2', title: 'Design Review',        roomName: 'room-design-review',   organizerId: 'u3', start: [0, 11, 30], end: [0, 12, 30], participantIds: ['u1', 'u3'] },
  { id: 'mt3', title: 'Engineering Sync',     roomName: 'room-eng-sync',        organizerId: 'u2', start: [0, 14],     end: [0, 15],    participantIds: ['u2', 'u4', 'u5'] },
  { id: 'mt4', title: 'Q2 Roadmap Review',    roomName: 'room-roadmap',         organizerId: 'u1', start: [2, 10],     end: [2, 11, 30], participantIds: ['u1', 'u2', 'u3'] },
  { id: 'mt5', title: 'All Hands',            roomName: 'room-all-hands',       organizerId: 'u7', start: [3, 16],     end: [3, 17],    participantIds: ALL_USER_IDS },
];

// `type` is uppercase in the schema and lowercase in `ActivityItem.kind`; the two
// are separate unions for separate screens, so this maps rather than aliases.
const calendarEvents: Array<{
  id: string;
  title: string;
  type: 'MEETING' | 'EVENT';
  organizerId: string;
  start: Window;
  end: Window;
  meetingId: string | null;
  location: string;
  attendeeIds: readonly string[];
}> = [
  { id: 'e1', title: 'Product Team Standup',   type: 'MEETING' as const, organizerId: 'u1', start: [0, 10],    end: [0, 10, 30], meetingId: 'mt1', location: 'Product Team', attendeeIds: ['u1', 'u2', 'u3'] },
  { id: 'e2', title: 'Design Review',          type: 'MEETING' as const, organizerId: 'u3', start: [0, 11, 30], end: [0, 12, 30], meetingId: 'mt2', location: 'Product Team', attendeeIds: ['u1', 'u3'] },
  { id: 'e3', title: 'Engineering Sync',       type: 'MEETING' as const, organizerId: 'u2', start: [0, 14],     end: [0, 15],    meetingId: 'mt3', location: 'Engineering',  attendeeIds: ['u2', 'u4', 'u5'] },
  { id: 'e4', title: 'Marketing Review',       type: 'EVENT'  as const, organizerId: 'u6', start: [1, 13],     end: [1, 14],    meetingId: null,    location: 'Marketing',   attendeeIds: ['u1', 'u6'] },
  { id: 'e5', title: 'Q2 Roadmap Review',      type: 'MEETING' as const, organizerId: 'u1', start: [2, 10],     end: [2, 11, 30], meetingId: 'mt4', location: 'Product Team', attendeeIds: ['u1', 'u2', 'u3'] },
  { id: 'e6', title: '1:1 with Sarah',         type: 'EVENT'  as const, organizerId: 'u1', start: [2, 15, 30], end: [2, 16],    meetingId: null,    location: 'Engineering',  attendeeIds: ['u1', 'u2'] },
  { id: 'e7', title: 'All Hands',              type: 'MEETING' as const, organizerId: 'u7', start: [3, 16],     end: [3, 17],    meetingId: 'mt5', location: 'Company',      attendeeIds: ALL_USER_IDS },
  { id: 'e8', title: 'Evening deploy window',  type: 'EVENT'  as const, organizerId: 'u2', start: [4, 19],     end: [4, 20],    meetingId: null,    location: 'Engineering',  attendeeIds: ['u2'] },
];

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const teamIdByName = new Map(teams.map((t) => [t.name, t.id]));

// `type` in the fixtures is a coarse UI label ('pdf', 'design', 'doc'), not a
// MIME type, so it is mapped to a real one. `.fig` has no registered type, which
// is why the fixtures use `application/octet-stream` for it.
const mimeByType: Record<string, string> = {
  pdf: 'application/pdf',
  design: 'application/octet-stream',
  image: 'image/jpeg',
  slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'text/markdown',
};

const files = [
  { id: 'f1', name: 'Product Docs',       isFolder: true,  size: 0,          team: 'Product Team', at: 1440 },
  { id: 'f2', name: 'Design Assets',      isFolder: true,  size: 0,          team: 'Product Team', at: 2000 },
  { id: 'f3', name: 'Meeting Recordings', isFolder: true,  size: 0,          team: 'Engineering',  at: 4000 },
  { id: 'f4', name: 'roadmap-q1.pdf',     isFolder: false, size: 2_400_000,  team: 'Product Team', at: 300,  type: 'pdf' },
  { id: 'f5', name: 'dashboard-design.fig', isFolder: false, size: 4_400_000, team: 'Product Team', at: 1200, type: 'design', starredBy: 'u1' },
  { id: 'f6', name: 'team-photo.jpg',     isFolder: false, size: 1_200_000,  team: 'General',      at: 2600, type: 'image' },
  { id: 'f7', name: 'presentation.pptx',  isFolder: false, size: 3_600_000,  team: 'Product Team', at: 3000, type: 'slides' },
  { id: 'f8', name: 'api-spec.md',        isFolder: false, size: 84_000,     team: 'Engineering',  at: 600,  type: 'doc' },
  { id: 'f9', name: 'release-notes.md',   isFolder: false, size: 42_000,     team: 'Engineering',  at: 900,  type: 'doc' },
] as const;

/* ------------------------------------------------------------------ */
/* Attendance and leave                                                */
/* ------------------------------------------------------------------ */

/**
 * The fixtures build attendance with a `flatMap` over the directory rather than
 * hand-writing 40 rows, so the same generator is reproduced here. It must stay
 * line-for-line equivalent or the seeded board stops matching the UI.
 *
 * The window starts at *yesterday*: today is left free so the signed-in person
 * can still use the check-in button. Every seeded day is in the past, so all of
 * them are closed out.
 */
function attendanceRows() {
  const statuses = ['PRESENT', 'PRESENT', 'LATE', 'REMOTE', 'PRESENT'] as const;
  const rows: Prisma.AttendanceCreateManyInput[] = [];

  users.forEach((person, personIndex) => {
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const status = statuses[(dayIndex + personIndex) % statuses.length];
      const checkInHour = status === 'LATE' ? 9 : 8;
      const checkIn = wallClockOnDay(-dayIndex - 1, checkInHour, 5 + personIndex * 3);
      const checkOut = wallClockOnDay(-dayIndex - 1, 18, 10 + personIndex);

      rows.push({
        id: `at-${person.id}-${dayIndex}`,
        userId: person.id,
        // Date-only column: an attendance day is calendar-local, so an instant
        // would reintroduce the timezone defect this column exists to prevent.
        date: new Date(`${checkIn.dayKey}T00:00:00.000Z`),
        checkIn: checkIn.date,
        checkOut: checkOut.date,
        status,
        overtimeMinutes: (personIndex + dayIndex) % 4 === 0 ? 45 : 0,
      });
    }
  });

  return rows;
}

// `from`/`to` are full instants, not dates: the leave form is built for a window
// inside a day, so the time the user typed has to survive.
const leaveRequests: Array<{
  id: string;
  userId: string;
  type: 'ANNUAL' | 'SICK' | 'PERSONAL' | 'PARENTAL' | 'UNPAID';
  from: Window;
  to: Window;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decidedById: string | null;
}> = [
  { id: 'l1', userId: 'u3', type: 'ANNUAL',  from: [7, 0],  to: [9, 0],  days: 3, reason: 'Family trip',    status: 'PENDING',  decidedById: null },
  { id: 'l2', userId: 'u2', type: 'SICK',    from: [-4, 0], to: [-4, 0], days: 1, reason: 'Unwell',         status: 'APPROVED', decidedById: 'u7' },
  { id: 'l3', userId: 'u1', type: 'ANNUAL',  from: [21, 0], to: [23, 0], days: 3, reason: 'Summer break',   status: 'PENDING',  decidedById: null },
];

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

// The six `activity` fixtures belong to the signed-in person, u1. The subtitle is
// prose in the fixture and is not stored -- the UI renders it from the target.
const notifications = [
  { id: 'a1', kind: 'MENTION' as const, actorId: 'u2', targetType: 'message', targetId: 'm1',  at: 10 },
  { id: 'a2', kind: 'FILE'    as const, actorId: 'u3', targetType: 'file',    targetId: 'f5',  at: 25 },
  { id: 'a3', kind: 'MEETING' as const, actorId: 'u2', targetType: 'meeting', targetId: 'mt3', at: 30 },
  { id: 'a4', kind: 'MESSAGE' as const, actorId: 'u5', targetType: 'message', targetId: 'm11', at: 60 },
  { id: 'a5', kind: 'LEAVE'   as const, actorId: null, targetType: 'leave',   targetId: 'l1',  at: 180 },
  { id: 'a6', kind: 'FILE'    as const, actorId: 'u4', targetType: 'file',    targetId: 'f8',  at: 400 },
];

/* ------------------------------------------------------------------ */
/* Wipe                                                                */
/* ------------------------------------------------------------------ */

// Child-first, so no statement trips a foreign key. `CASCADE` would cover the
// ordering automatically but also silently drops anything added later that
// nothing references, which is the wrong trade for a seed.
const TABLES = [
  'Notification', 'Reaction', 'Message', 'MeetingParticipant',
  'CalendarAttendee', 'CalendarEvent', 'Meeting', 'File', 'ChannelReadState',
  'Channel', 'TeamMember', 'Team', 'LeaveBalance', 'LeaveRequest', 'Attendance',
  'Session', 'Department', 'User',
] as const;

async function wipe() {
  const existing = await prisma.user.count();
  if (existing > 0 && process.env.SEED_ALLOW_WIPE !== 'true') {
    throw new Error(
      `Refusing to truncate a database holding ${existing} users.\n` +
      'This is a demo seed, not a migration. Re-run with SEED_ALLOW_WIPE=true to\n' +
      'replace the contents, or use `npm run db:reset` to drop and rebuild.',
    );
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

/**
 * MIME type for a file row.
 *
 * Throws rather than falling back, because the fallback would be `undefined`
 * reaching a NOT NULL column and failing somewhere less obvious than here. The
 * real risk is a fixture gaining a new `type` without a matching entry in the
 * map, and this is where that should be noticed.
 */
function mimeFor(file: (typeof files)[number]): string {
  if (file.isFolder) return 'inode/directory';
  const type = 'type' in file ? file.type : undefined;
  if (!type) throw new Error(`file ${file.id} is not a folder but has no type`);
  const mime = mimeByType[type];
  if (!mime) throw new Error(`no MIME type mapped for file type "${type}" (${file.id})`);
  return mime;
}

async function main() {
  await wipe();

  // Password hashes are left null: seeded users are display data, and auth has
  // not been designed yet. Fixing a hash algorithm here would bake a choice in
  // before the login flow exists to justify it. The auth phase sets these.
  //
  // departmentId is held back: User and Department reference each other
  // (`User.departmentId` and `Department.headId`), so neither can be inserted
  // first. Both columns are filled in by the second pass below.
  await prisma.user.createMany({
    data: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      jobTitle: u.jobTitle,
      employeeCode: u.employeeCode,
      role: u.role,
      phone: u.phone,
      bio: u.bio,
      joinedAt: new Date('2023-04-03T00:00:00.000Z'),
    })),
  });

  await prisma.department.createMany({
    data: departments.map((d) => ({ id: d.id, name: d.name, description: d.description })),
  });

  // Close the cycle now that both sides exist.
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { departmentId: u.departmentId } });
  }
  for (const d of departments) {
    await prisma.department.update({ where: { id: d.id }, data: { headId: d.headId } });
  }

  // `mine`/`myRole` in the fixtures are properties of the *viewing* user, so they
  // live on the membership row, not on the team. Only u1's view is seeded.
  await prisma.team.createMany({ data: teams.map(({ mine, myRole, memberIds, ...team }) => team) });

  // The fixtures disagree with themselves here: t2 and t3 are both marked
  // `mine: true` while their memberIds omit u1 entirely. `mine` is taken as
  // authoritative -- it is what the Teams page keys its "yours" filter off -- and
  // u1 is added where it is set. Keyed by userId so a person already in
  // memberIds is not inserted twice against the (userId, teamId) unique index.
  await prisma.teamMember.createMany({
    data: teams.flatMap((team) => {
      const members = new Map<string, 'OWNER' | 'ADMIN' | 'MEMBER'>(
        team.memberIds.map((userId) => [userId, 'MEMBER' as const]),
      );
      if (team.mine) members.set('u1', team.myRole ?? 'MEMBER');
      return [...members].map(([userId, role]) => ({ teamId: team.id, userId, role }));
    }),
  });

  await prisma.channel.createMany({ data: channels });

  // Read state is per (user, channel). Only c1 has a derivable unread count of 2:
  // setting the marker 145 minutes back leaves the 141- and 120-minute messages
  // newer than it. c3 shows `unread: 1` in the fixtures but contains no messages,
  // so there is nothing for a count to be derived from -- it will read 0.
  await prisma.channelReadState.createMany({
    data: channels.map((c) => ({
      userId: 'u1',
      channelId: c.id,
      lastReadAt: c.id === 'c1' ? minutesAgo(145) : new Date(),
    })),
  });

  await prisma.meeting.createMany({
    data: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      roomName: m.roomName,
      organizerId: m.organizerId,
      startsAt: at(m.start),
      endsAt: at(m.end),
    })),
  });
  await prisma.meetingParticipant.createMany({
    data: meetings.flatMap((m) =>
      m.participantIds.map((userId) => ({ meetingId: m.id, userId })),
    ),
  });

  await prisma.calendarEvent.createMany({
    data: calendarEvents.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      organizerId: e.organizerId,
      startsAt: at(e.start),
      endsAt: at(e.end),
      meetingId: e.meetingId,
      location: e.location,
    })),
  });
  await prisma.calendarAttendee.createMany({
    data: calendarEvents.flatMap((e) =>
      e.attendeeIds.map((userId) => ({ eventId: e.id, userId })),
    ),
  });

  await prisma.file.createMany({
    data: files.map((f) => ({
      id: f.id,
      name: f.name,
      isFolder: f.isFolder,
      mimeType: mimeFor(f),
      // BigInt: over 2^31 is exactly the case the column exists for.
      sizeBytes: BigInt(f.size),
      // Server-generated key, never the client-supplied name. These rows are
      // display fixtures with no bytes behind them, so a download 404s until the
      // file is re-uploaded -- the same distinction the frontend marks with
      // `uploaded?: boolean`.
      storageKey: `seed/${f.id}-${f.name}`,
      teamId: teamIdByName.get(f.team) ?? null,
      uploadedById: 'u1',
      createdAt: minutesAgo(f.at),
    })),
  });
  // Starred is a per-user many-to-many; the fixtures only mark f5, in u1's view.
  await prisma.file.update({ where: { id: 'f5' }, data: { starredBy: { connect: [{ id: 'u1' }] } } });

  await prisma.message.createMany({
    data: [
      ...messages.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        userId: m.userId,
        body: m.body,
        createdAt: minutesAgo(m.at),
      })),
      ...meetingMessages.map((m) => ({
        id: m.id,
        meetingId: m.meetingId,
        userId: m.userId,
        body: m.body,
        createdAt: minutesAgo(m.at),
      })),
    ],
  });

  // The fixture attaches { id: 'f2', name: 'dashboard-design.fig' } to m3, but
  // 'f2' is already the Design Assets *folder* in the files list. File ids are
  // global, so the attachment resolves to the real 4.4 MB design file, f5.
  await prisma.message.update({
    where: { id: 'm3' },
    data: { attachments: { connect: [{ id: 'f5' }] } },
  });

  await prisma.reaction.createMany({ data: reactions });
  await prisma.attendance.createMany({ data: attendanceRows() });

  await prisma.leaveRequest.createMany({
    data: leaveRequests.map((l) => ({
      id: l.id,
      userId: l.userId,
      type: l.type,
      fromDate: at(l.from),
      toDate: at(l.to),
      days: l.days,
      reason: l.reason,
      status: l.status,
      decidedById: l.decidedById,
      decidedAt: l.decidedById ? minutesAgo(180) : null,
    })),
  });

  // No leave-balance fixtures exist, but the approval flow needs a balance to
  // check against. Seeded to match the approved requests so the two agree.
  const year = appYear();
  await prisma.leaveBalance.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: 'ANNUAL' as const,
      year,
      entitled: 18,
      used: 0,
    })),
  });
  await prisma.leaveBalance.updateMany({
    where: { userId: 'u1' },
    data: { used: 0 },
  });

  await prisma.notification.createMany({
    data: notifications.map((n) => ({
      id: n.id,
      userId: 'u1',
      kind: n.kind,
      actorId: n.actorId,
      targetType: n.targetType,
      targetId: n.targetId,
      createdAt: minutesAgo(n.at),
    })),
  });

  // Logged, because a seed that silently writes nothing is worse than one that
  // fails. These counts are the contract the frontend fixtures imply.
  const counts = {
    users: await prisma.user.count(),
    departments: await prisma.department.count(),
    teams: await prisma.team.count(),
    teamMembers: await prisma.teamMember.count(),
    channels: await prisma.channel.count(),
    messages: await prisma.message.count(),
    reactions: await prisma.reaction.count(),
    meetings: await prisma.meeting.count(),
    meetingParticipants: await prisma.meetingParticipant.count(),
    events: await prisma.calendarEvent.count(),
    attendees: await prisma.calendarAttendee.count(),
    files: await prisma.file.count(),
    attendance: await prisma.attendance.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    leaveBalances: await prisma.leaveBalance.count(),
    notifications: await prisma.notification.count(),
  };

  console.log('seed complete');
  for (const [label, count] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(20)} ${count}`);
  }
  console.log(`\n  today in ${'Asia/Kolkata'}: ${appDayKey(new Date())}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
