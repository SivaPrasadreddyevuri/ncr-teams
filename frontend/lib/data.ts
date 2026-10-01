import { daysFromNow, localDayKey, relativeIso } from './format';
import type { Channel, ChatMessage, Person, Team } from './api';

/**
 * Seed data.
 *
 * This is the cold-start fallback: a visitor whose first load has no session, no
 * cache and no reachable API still gets a populated app rather than an empty one.
 * Once a screen is verified against the API, the fixtures stop being the source
 * of truth for it -- but they stay here as the thing that renders before any
 * request completes.
 *
 * ## Which types are imported, and which are not
 *
 * `Person`, `Team`, `Channel` and `ChatMessage` are re-exported from `lib/api`
 * rather than declared again. They were duplicated here once and the copies
 * drifted: the fixture versions were narrower than the API's, because every seeded
 * row happened to have a value where the API can return null. A duplicate type is a
 * drift bug waiting to happen.
 *
 * `ChatMessage` drifted the same way, and the drift was visible rather than
 * theoretical -- the fixture version had no `deleted` and no `editedAt`, so a
 * component reading a live message could not render a tombstone or an "edited"
 * label without a cast, and the same component reading a fixture one had to.
 *
 * `ActivityItem` is *not* shared, and deliberately so. The version below is
 * presentation -- a `title` and a `subtitle` written once at seed time. The API
 * returns structured `actor` and `target` instead, on the reasoning that prose
 * frozen at seed time goes stale the moment anything is renamed. A screen
 * reading activity from the API has to compose that prose itself, which is real
 * work in the component rather than a type alias.
 */
export type { Channel, ChatMessage, Person, Team };

/**
 * Mock dataset.
 *
 * This is a UI-only prototype: there is no database and no server. Every screen
 * renders from the data in this file, and interactions mutate local React state
 * only -- nothing is persisted between reloads.
 *
 * Timestamps are computed relative to "now" so the demo always looks current.
 */

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */


export const currentUser: Person = {
  id: 'u1',
  name: 'Alex Johnson',
  email: 'alex@company.com',
  jobTitle: 'Product Manager',
  employeeCode: 'EMP-1001',
  role: 'EMPLOYEE',
  department: 'Product',
  phone: '+1 555 0100',
  online: true,
  bio: 'Product manager focused on the collaboration platform.',
};

export const directory: Person[] = [
  currentUser,
  {
    id: 'u2',
    name: 'Sarah Johnson',
    email: 'sarah@company.com',
    jobTitle: 'Engineering Manager',
    employeeCode: 'EMP-1002',
    role: 'MANAGER',
    department: 'Engineering',
    phone: '+1 555 0101',
    online: true,
    bio: 'Leads the platform engineering team.',
  },
  {
    id: 'u3',
    name: 'Emma Davis',
    email: 'emma@company.com',
    jobTitle: 'Senior Product Designer',
    employeeCode: 'EMP-1003',
    role: 'EMPLOYEE',
    department: 'Design',
    phone: '+1 555 0102',
    online: true,
    bio: 'Designs the dashboard and settings surfaces.',
  },
  {
    id: 'u4',
    name: 'Michael Chen',
    email: 'michael@company.com',
    jobTitle: 'Staff Engineer',
    employeeCode: 'EMP-1004',
    role: 'EMPLOYEE',
    department: 'Engineering',
    phone: '+1 555 0103',
    online: false,
    bio: 'Backend and data infrastructure.',
  },
  {
    id: 'u5',
    name: 'James Wilson',
    email: 'james@company.com',
    jobTitle: 'Backend Engineer',
    employeeCode: 'EMP-1005',
    role: 'EMPLOYEE',
    department: 'Engineering',
    phone: '+1 555 0104',
    online: true,
    bio: 'APIs and integrations.',
  },
  {
    id: 'u6',
    name: 'Emily Davis',
    email: 'emily@company.com',
    jobTitle: 'Marketing Specialist',
    employeeCode: 'EMP-1006',
    role: 'EMPLOYEE',
    department: 'Marketing',
    phone: '+1 555 0105',
    online: false,
    bio: 'Campaigns and go-to-market.',
  },
  {
    id: 'u7',
    name: 'Priya Nair',
    email: 'priya@company.com',
    jobTitle: 'Head of People',
    employeeCode: 'EMP-1007',
    role: 'HR_ADMIN',
    department: 'People',
    phone: '+1 555 0106',
    online: true,
    bio: 'HR, hiring and workplace operations.',
  },
  {
    id: 'u8',
    name: 'Tom Baker',
    email: 'tom@company.com',
    jobTitle: 'Sales Lead',
    employeeCode: 'EMP-1008',
    role: 'MANAGER',
    department: 'Sales',
    phone: '+1 555 0107',
    online: false,
    bio: 'Revenue and customer success.',
  },
];

export const departments = [
  { id: 'd1', name: 'Engineering', description: 'Product engineering and platform', head: 'Sarah Johnson', members: 3 },
  { id: 'd2', name: 'Product', description: 'Product management', head: 'Alex Johnson', members: 1 },
  { id: 'd3', name: 'Design', description: 'Brand, product design and research', head: 'Emma Davis', members: 1 },
  { id: 'd4', name: 'Marketing', description: 'Demand generation and communications', head: 'Emily Davis', members: 1 },
  { id: 'd5', name: 'People', description: 'HR, hiring and workplace operations', head: 'Priya Nair', members: 1 },
  { id: 'd6', name: 'Sales', description: 'Revenue and customer success', head: 'Tom Baker', members: 1 },
];

export const personById = (id: string) => directory.find((p) => p.id === id);

/* ------------------------------------------------------------------ */
/* Teams and channels                                                  */
/* ------------------------------------------------------------------ */



export const teams: Team[] = [
  { id: 't1', name: 'Product Team', description: 'Product development and collaboration', memberIds: ['u1', 'u2', 'u3'], memberCount: 12, channelCount: 4, mine: true, myRole: 'OWNER' },
  { id: 't2', name: 'Engineering', description: 'Build and maintain the platform', memberIds: ['u2', 'u4', 'u5'], memberCount: 18, channelCount: 4, mine: true, myRole: 'MEMBER' },
  { id: 't3', name: 'Design Team', description: 'Product design and design system', memberIds: ['u3'], memberCount: 12, channelCount: 3, mine: true, myRole: 'OWNER' },
  { id: 't4', name: 'Marketing', description: 'Campaigns and go-to-market', memberIds: ['u6'], memberCount: 8, channelCount: 2, mine: false, myRole: 'MEMBER' },
  { id: 't5', name: 'HR', description: 'People operations', memberIds: ['u7'], memberCount: 24, channelCount: 3, mine: false, myRole: 'MEMBER' },
  { id: 't6', name: 'Operations', description: 'Internal operations', memberIds: [], memberCount: 14, channelCount: 2, mine: false, myRole: 'MEMBER' },
  { id: 't7', name: 'Sales', description: 'Pipeline and customers', memberIds: ['u7', 'u8'], memberCount: 10, channelCount: 2, mine: false, myRole: 'MEMBER' },
  { id: 't8', name: 'General', description: 'Company-wide announcements', memberIds: directory.map((p) => p.id), memberCount: 8, channelCount: 2, mine: true, myRole: 'MEMBER' },
];

export const channels: Channel[] = [
  { id: 'c1', name: 'general', teamName: 'Product Team', teamId: 't1', lastMessage: "Perfect, I will prepare the review.", lastAt: relativeIso(120), unread: 2, memberIds: ['u1', 'u2', 'u3'] },
  { id: 'c2', name: 'product-updates', teamName: 'Product Team', teamId: 't1', lastMessage: 'Shipping the Q2 roadmap on Friday.', lastAt: relativeIso(90), unread: 0, memberIds: ['u1', 'u2', 'u3'] },
  { id: 'c3', name: 'design-review', teamName: 'Product Team', teamId: 't1', lastMessage: 'Critique doc is ready for the settings page.', lastAt: relativeIso(60), unread: 1, memberIds: ['u1', 'u3'] },
  { id: 'c4', name: 'roadmap', teamName: 'Product Team', teamId: 't1', lastMessage: 'Q3 themes added to the roadmap.', lastAt: relativeIso(300), unread: 0, memberIds: ['u1', 'u2', 'u3'] },
  { id: 'c5', name: 'general', teamName: 'Engineering', teamId: 't2', lastMessage: 'Deploy to staging is green.', lastAt: relativeIso(200), unread: 0, memberIds: ['u2', 'u4', 'u5'] },
  { id: 'c6', name: 'backend', teamName: 'Engineering', teamId: 't2', lastMessage: 'Migration dry run finished.', lastAt: relativeIso(180), unread: 0, memberIds: ['u2', 'u4', 'u5'] },
  { id: 'c7', name: 'incidents', teamName: 'Engineering', teamId: 't2', lastMessage: 'Elevated latency resolved.', lastAt: relativeIso(420), unread: 0, memberIds: ['u2', 'u4'] },
  { id: 'c8', name: 'critique', teamName: 'Design Team', teamId: 't3', lastMessage: 'Design critique notes are up.', lastAt: relativeIso(60), unread: 0, memberIds: ['u3'] },
  { id: 'c9', name: 'general', teamName: 'General', teamId: 't8', lastMessage: 'Welcome to everyone joining this week.', lastAt: relativeIso(1440), unread: 0, memberIds: directory.map((p) => p.id) },
  { id: 'c10', name: 'random', teamName: 'General', teamId: 't8', lastMessage: 'Coffee recommendation thread.', lastAt: relativeIso(2000), unread: 0, memberIds: directory.map((p) => p.id) },
];

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const messages: ChatMessage[] = [
  { id: 'm1', channelId: 'c1', authorId: 'u2', body: 'Hey team, standup notes are up.', createdAt: relativeIso(240), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm2', channelId: 'c1', authorId: 'u1', body: "I'll review the dashboard design this morning.", createdAt: relativeIso(232), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm3', channelId: 'c1', authorId: 'u3', body: "Here's the updated dashboard design for the dashboard.", createdAt: relativeIso(150), reactions: [{ emoji: '👍', userIds: ['u2', 'u4'] }], attachments: [{ id: 'f2', name: 'dashboard-design.fig', size: 4_400_000, type: 'application/octet-stream' }], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm4', channelId: 'c1', authorId: 'u1', body: 'Looks great. The new navigation and activity cards are in there too.', createdAt: relativeIso(148), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm5', channelId: 'c1', authorId: 'u2', body: 'Perfect! I will prepare the review.', createdAt: relativeIso(141), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm6', channelId: 'c1', authorId: 'u3', body: 'Perfect, I will prepare the review.', createdAt: relativeIso(120), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm7', channelId: 'c2', authorId: 'u1', body: 'Shipping the Q2 roadmap on Friday.', createdAt: relativeIso(90), reactions: [{ emoji: '🎉', userIds: ['u3'] }], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm8', channelId: 'c5', authorId: 'u4', body: 'Deploy to staging is green.', createdAt: relativeIso(200), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm9', channelId: 'c5', authorId: 'u5', body: 'Nice. Running the migration dry run now.', createdAt: relativeIso(180), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm10', channelId: 'c8', authorId: 'u3', body: 'Critique doc for the settings page is ready.', createdAt: relativeIso(60), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
  { id: 'm11', channelId: 'c9', authorId: 'u1', body: 'Welcome to everyone joining this week.', createdAt: relativeIso(1440), reactions: [], attachments: [], deleted: false, editedAt: null, parentId: null, parentAuthor: null },
];

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  type: 'MEETING' | 'EVENT';
  organizerId: string;
  attendeeIds: string[];
  meetingId: string | null;
  location: string;
};

export const calendarEvents: CalendarEvent[] = [
  { id: 'e1', title: 'Product Team Standup', startsAt: daysFromNow(0, 10), endsAt: daysFromNow(0, 10, 30), type: 'MEETING', organizerId: 'u1', attendeeIds: ['u1', 'u2', 'u3'], meetingId: 'mt1', location: 'Product Team' },
  { id: 'e2', title: 'Design Review', startsAt: daysFromNow(0, 11, 30), endsAt: daysFromNow(0, 12, 30), type: 'MEETING', organizerId: 'u3', attendeeIds: ['u1', 'u3'], meetingId: 'mt2', location: 'Product Team' },
  { id: 'e3', title: 'Engineering Sync', startsAt: daysFromNow(0, 14), endsAt: daysFromNow(0, 15), type: 'MEETING', organizerId: 'u2', attendeeIds: ['u2', 'u4', 'u5'], meetingId: 'mt3', location: 'Engineering' },
  { id: 'e4', title: 'Marketing Review', startsAt: daysFromNow(1, 13), endsAt: daysFromNow(1, 14), type: 'EVENT', organizerId: 'u6', attendeeIds: ['u1', 'u6'], meetingId: null, location: 'Marketing' },
  { id: 'e5', title: 'Q2 Roadmap Review', startsAt: daysFromNow(2, 10), endsAt: daysFromNow(2, 11, 30), type: 'MEETING', organizerId: 'u1', attendeeIds: ['u1', 'u2', 'u3'], meetingId: 'mt4', location: 'Product Team' },
  { id: 'e6', title: '1:1 with Sarah', startsAt: daysFromNow(2, 15, 30), endsAt: daysFromNow(2, 16), type: 'EVENT', organizerId: 'u1', attendeeIds: ['u1', 'u2'], meetingId: null, location: 'Engineering' },
  { id: 'e7', title: 'All Hands', startsAt: daysFromNow(3, 16), endsAt: daysFromNow(3, 17), type: 'MEETING', organizerId: 'u7', attendeeIds: directory.map((p) => p.id), meetingId: 'mt5', location: 'Company' },
  { id: 'e8', title: 'Evening deploy window', startsAt: daysFromNow(4, 19), endsAt: daysFromNow(4, 20), type: 'EVENT', organizerId: 'u2', attendeeIds: ['u2'], meetingId: null, location: 'Engineering' },
];

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

export type Meeting = {
  id: string;
  title: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  organizerId: string;
  participantIds: string[];
  messages: Array<{ id: string; authorId: string; body: string; createdAt: string }>;
};

export const meetings: Meeting[] = [
  { id: 'mt1', title: 'Product Team Standup', roomName: 'room-product-standup', startsAt: daysFromNow(0, 10), endsAt: daysFromNow(0, 10, 30), organizerId: 'u1', participantIds: ['u1', 'u2', 'u3'], messages: [{ id: 'mm1', authorId: 'u2', body: "Let's review the latest dashboard design.", createdAt: relativeIso(300) }] },
  { id: 'mt2', title: 'Design Review', roomName: 'room-design-review', startsAt: daysFromNow(0, 11, 30), endsAt: daysFromNow(0, 12, 30), organizerId: 'u3', participantIds: ['u1', 'u3'], messages: [] },
  { id: 'mt3', title: 'Engineering Sync', roomName: 'room-eng-sync', startsAt: daysFromNow(0, 14), endsAt: daysFromNow(0, 15), organizerId: 'u2', participantIds: ['u2', 'u4', 'u5'], messages: [{ id: 'mm2', authorId: 'u4', body: 'Staging is green, ready for review.', createdAt: relativeIso(200) }] },
  { id: 'mt4', title: 'Q2 Roadmap Review', roomName: 'room-roadmap', startsAt: daysFromNow(2, 10), endsAt: daysFromNow(2, 11, 30), organizerId: 'u1', participantIds: ['u1', 'u2', 'u3'], messages: [] },
  { id: 'mt5', title: 'All Hands', roomName: 'room-all-hands', startsAt: daysFromNow(3, 16), endsAt: daysFromNow(3, 17), organizerId: 'u7', participantIds: directory.map((p) => p.id), messages: [{ id: 'mm3', authorId: 'u7', body: 'Agenda is in the channel.', createdAt: relativeIso(400) }] },
];

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export type FileRow = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  team: string;
  type: string;
  folder?: boolean;
  starred?: boolean;
  /**
   * Set on rows this browser actually uploaded.
   *
   * The seeded fixtures have no bytes behind them -- they are display data --
   * so a click on one has nothing to open. Marking the difference keeps an
   * unopenable file from looking like a broken button.
   */
  uploaded?: boolean;
};

export const files: FileRow[] = [
  { id: 'f1', name: 'Product Docs', size: 0, createdAt: relativeIso(1440), team: 'Product Team', type: 'folder', folder: true },
  { id: 'f2', name: 'Design Assets', size: 0, createdAt: relativeIso(2000), team: 'Product Team', type: 'folder', folder: true },
  { id: 'f3', name: 'Meeting Recordings', size: 0, createdAt: relativeIso(4000), team: 'Engineering', type: 'folder', folder: true },
  { id: 'f4', name: 'roadmap-q1.pdf', size: 2_400_000, createdAt: relativeIso(300), team: 'Product Team', type: 'pdf' },
  { id: 'f5', name: 'dashboard-design.fig', size: 4_400_000, createdAt: relativeIso(1200), team: 'Product Team', type: 'design', starred: true },
  { id: 'f6', name: 'team-photo.jpg', size: 1_200_000, createdAt: relativeIso(2600), team: 'General', type: 'image' },
  { id: 'f7', name: 'presentation.pptx', size: 3_600_000, createdAt: relativeIso(3000), team: 'Product Team', type: 'slides' },
  { id: 'f8', name: 'api-spec.md', size: 84_000, createdAt: relativeIso(600), team: 'Engineering', type: 'doc' },
  { id: 'f9', name: 'release-notes.md', size: 42_000, createdAt: relativeIso(900), team: 'Engineering', type: 'doc' },
];

/* ------------------------------------------------------------------ */
/* Attendance, leave, activity                                         */
/* ------------------------------------------------------------------ */

export type AttendanceRecord = {
  id: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'PRESENT' | 'LATE' | 'REMOTE' | 'ABSENT' | 'HALF_DAY';
  overtimeMinutes: number;
};

export const attendance: AttendanceRecord[] = directory.flatMap((person, personIndex) =>
  Array.from({ length: 5 }, (_, dayIndex) => {
    const statuses: AttendanceRecord['status'][] = ['PRESENT', 'PRESENT', 'LATE', 'REMOTE', 'PRESENT'];
    const status = statuses[(dayIndex + personIndex) % statuses.length];
    const checkInHour = status === 'LATE' ? 9 : 8;

    // setDate rather than subtracting milliseconds, so a DST boundary in the
    // window cannot shift the key onto the wrong day.
    //
    // The window starts at *yesterday*, not today. Including today left the
    // board already checked in on load, which disabled the check-in button
    // permanently and made the button that matters look broken. Today is now
    // the signed-in person's to fill in.
    const dayDate = new Date();
    dayDate.setDate(dayDate.getDate() - dayIndex - 1);
    const day = localDayKey(dayDate);

    return {
      id: `at-${person.id}-${dayIndex}`,
      userId: person.id,
      date: day,
      // Local wall-clock time. Date-only strings would be read as UTC and can
      // land on the wrong day west of Greenwich.
      checkIn: `${day}T${String(checkInHour).padStart(2, '0')}:${String(5 + personIndex * 3).padStart(2, '0')}:00`,
      // Every seeded day is in the past, so all of them are closed out.
      checkOut: `${day}T18:${String(10 + personIndex).padStart(2, '0')}:00`,
      status,
      // Spread across people *and* days so the demo does not show the same
      // overtime figure on every row for one person.
      overtimeMinutes: (personIndex + dayIndex) % 4 === 0 ? 45 : 0,
    };
  }),
);

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL', 'PARENTAL', 'UNPAID'] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export type LeaveRequest = {
  id: string;
  userId: string;
  type: LeaveType | string;
  /**
   * Full instants, not bare dates. A request can span a specific window -- "09:00
   * to 17:00 on the 14th" -- and the form needs the time, so the original
   * day-only strings were already carrying more than they displayed.
   */
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedById: string | null;
  /** When the decision was made. Optional: the seed rows predate it. */
  decidedAt?: string;
};

export const leaveRequests: LeaveRequest[] = [
  { id: 'l1', userId: 'u3', type: 'ANNUAL', from: daysFromNow(7, 0), to: daysFromNow(9, 0), days: 3, reason: 'Family trip', status: 'PENDING', decidedById: null },
  { id: 'l2', userId: 'u2', type: 'SICK', from: daysFromNow(-4, 0), to: daysFromNow(-4, 0), days: 1, reason: 'Unwell', status: 'APPROVED', decidedById: 'u7' },
  { id: 'l3', userId: 'u1', type: 'ANNUAL', from: daysFromNow(21, 0), to: daysFromNow(23, 0), days: 3, reason: 'Summer break', status: 'PENDING', decidedById: null },
];

export type ActivityItem = {
  id: string;
  kind: 'message' | 'file' | 'meeting' | 'leave';
  title: string;
  subtitle: string;
  at: string;
};

export const activity: ActivityItem[] = [
  { id: 'a1', kind: 'message', title: 'Sarah mentioned you', subtitle: 'In Product Team • Design Review', at: relativeIso(10) },
  { id: 'a2', kind: 'file', title: 'New file shared', subtitle: 'Emma shared dashboard-design.fig', at: relativeIso(25) },
  { id: 'a3', kind: 'meeting', title: 'Meeting starting soon', subtitle: 'Engineering Sync starts in 30 min', at: relativeIso(30) },
  { id: 'a4', kind: 'message', title: 'James reacted to your message', subtitle: 'In General', at: relativeIso(60) },
  { id: 'a5', kind: 'leave', title: 'Leave request pending', subtitle: 'Emma Davis • 3 days from next week', at: relativeIso(180) },
  { id: 'a6', kind: 'file', title: 'New file shared', subtitle: 'Michael shared api-spec.md in Engineering', at: relativeIso(400) },
];

/* ------------------------------------------------------------------ */
/* Dashboard counters                                                  */
/* ------------------------------------------------------------------ */

export const dashboardStats = {
  messages: 8,
  meetings: calendarEvents.filter((e) => e.type === 'MEETING').length,
  pendingRequests: leaveRequests.filter((l) => l.status === 'PENDING').length,
  mentions: 1,
};

/* ------------------------------------------------------------------ */
/* Apps launcher                                                       */
/* ------------------------------------------------------------------ */

export const appCounts = {
  channels: channels.length,
  events: calendarEvents.length,
  files: files.length,
  meetings: meetings.length,
  attendance: attendance.filter((a) => a.userId === currentUser.id).length,
};
