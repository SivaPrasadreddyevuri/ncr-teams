import { dateColumnToDayKey } from './app-time.js';
/**
 * Response shapes shared with the frontend.
 *
 * Each one mirrors a type in `frontend/lib/data.ts`, field for field, because
 * the point of the API phase is that the frontend can swap fixtures for a live
 * call without rewriting the components that consume them. Two deliberate
 * renames:
 *
 * - `Message.userId` is returned as `authorId`, the name the fixture and
 *   `ChatMessage` already use. The column is named for what it is; the response
 *   is named for what the caller expects.
 * - File `size` is a number. `sizeBytes` is `BigInt` in the database and
 *   `sendJson` renders it as a string to avoid silent precision loss, but file
 *   sizes are far below 2^53 and `formatBytes` takes a number, so the DTO
 *   converts explicitly rather than leaving a string in a field typed `number`.
 */

export type PersonDto = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  employeeCode: string | null;
  role: 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';
  department: string | null;
  phone: string;
  online: boolean;
  bio: string;
  avatarUrl?: string;
};

export type TeamDto = {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  memberCount: number;
  channelCount: number;
  mine: boolean;
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

export type ChannelDto = {
  id: string;
  name: string;
  teamName: string;
  teamId: string;
  lastMessage: string;
  lastAt: string | null;
  unread: number;
  memberIds: string[];
};

export type DepartmentDto = {
  id: string;
  name: string;
  description: string;
  head: string;
  members: number;
};

export type ReactionDto = { emoji: string; userIds: string[] };
export type AttachmentDto = { id: string; name: string; size: number; type: string };

/** Mirrors `ChatMessage` in data.ts. */
export type MessageDto = {
  id: string;
  channelId: string;
  /**
   * The meeting this message was posted in, or null for a channel message.
   *
   * Exactly one of `channelId` and `meetingId` is meaningful. Meeting chat is a
   * separate conversation from the channel the call was opened from, so the client
   * has to be able to tell them apart rather than inferring it from an empty
   * `channelId`.
   */
  meetingId: string | null;
  authorId: string;
  body: string;
  createdAt: string;
  reactions: ReactionDto[];
  attachments: AttachmentDto[];
  /** Set once a message has been soft deleted, so the UI can show a tombstone. */
  deleted: boolean;
  editedAt: string | null;
  /**
   * The message this one replies to, or null.
   *
   * Replies render inline in the channel rather than in a side panel, so the
   * context has to travel with the message: "Replying to Sarah" with no way to
   * render it would need a second request per reply on screen.
   */
  parentId: string | null;
  /**
   * The parent's author name, already resolved.
   *
   * Null only when there is no parent, or when the caller did not join it. A
   * soft-deleted parent still has an author, and naming them is right: the reply
   * genuinely was in reply to something they wrote. Discord and Slack both keep the
   * attribution and show the parent as deleted text.
   */
  parentAuthor: string | null;
};

/** Mirrors `FileRow` in data.ts, plus the fields the API adds. */
export type FileDto = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  team: string;
  /** A real MIME type. The UI derives its own label from this. */
  mimeType: string;
  isFolder: boolean;
  folder?: boolean;
  starred: boolean;
  /**
   * Whether bytes actually exist behind this row.
   *
   * The seeded files start as metadata only, and on the ephemeral free-tier
   * filesystem a row can outlive its bytes. A row that says `uploaded: false`
   * must not render as a working download button.
   */
  uploaded: boolean;
  deletedAt: string | null;
};

export type ActivityTarget =
  | { kind: 'message'; id: string; body: string; channelName: string | null }
  | { kind: 'file'; id: string; name: string; sizeBytes: string }
  | { kind: 'meeting'; id: string; title: string; startsAt: string }
  | { kind: 'leave'; id: string; status: string; days: number; from: string; to: string }
  | null;

export type ActivityItemDto = {
  id: string;
  kind: 'MESSAGE' | 'FILE' | 'MEETING' | 'LEAVE' | 'MENTION';
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null } | null;
  target: ActivityTarget;
};

/* ------------------------------------------------------------------ */
/* Row -> DTO                                                           */
/* ------------------------------------------------------------------ */

type MessageRow = {
  id: string;
  channelId: string | null;
  /**
   * The meeting this message belongs to, or null for a channel message.
   *
   * Selected rather than left out because the DTO has to say which conversation a
   * message is in: `channelId` alone cannot distinguish a channel message from one
   * posted inside a call, and the realtime relay routes on exactly this field.
   */
  meetingId: string | null;
  userId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  parentId: string | null;
  /**
   * The parent, joined in by the caller.
   *
   * Optional rather than required so selects that do not need reply context keep
   * compiling; the routes that render a thread include it and the ones that do not
   * leave it undefined, which renders as "no reply context" rather than a crash.
   *
   * The author's *name* is selected rather than just their id, so a page of fifty
   * messages resolves every "Replying to ..." in the same query instead of one per
   * reply on screen.
   */
  parent?: { userId: string; user: { name: string } } | null;
  reactions: Array<{ emoji: string; userId: string }>;
  attachments: Array<{ id: string; name: string; sizeBytes: bigint; mimeType: string }>;
};

export function toMessageDto(row: MessageRow): MessageDto {
  // Grouped into `{ emoji, userIds }` because that is the read shape the
  // fixture uses. The database stores one row per person per emoji, since that
  // is the only shape that can enforce "a person cannot react twice".
  const byEmoji = new Map<string, string[]>();
  for (const reaction of row.reactions) {
    const existing = byEmoji.get(reaction.emoji);
    if (existing) existing.push(reaction.userId);
    else byEmoji.set(reaction.emoji, [reaction.userId]);
  }

  return {
    id: row.id,
    // A message in a meeting has no channel. The field is non-null in the
    // fixture's `ChatMessage`, so an empty string is the honest rendering of
    // "not in a channel" for a type that cannot express it.
    channelId: row.channelId ?? '',
    meetingId: row.meetingId ?? null,
    authorId: row.userId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    reactions: [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: Number(attachment.sizeBytes),
      type: attachment.mimeType,
    })),
    deleted: row.deletedAt !== null,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    parentId: row.parentId ?? null,
    // Null rather than "Unknown": absent is the honest rendering, and the parent
    // author is only absent when there is no parent. `parent` is undefined when the
    // caller did not join it, which is the same rendering as a missing parent.
    parentAuthor: row.parent?.user.name ?? null,
  };
}

type FileRow = {
  id: string;
  name: string;
  sizeBytes: bigint;
  mimeType: string;
  isFolder: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  team: { name: string | null } | null;
  starredBy: Array<{ id: string }>;
};

export function toFileDto(row: FileRow, uploaded: boolean, viewerId: string): FileDto {
  return {
    id: row.id,
    name: row.name,
    size: Number(row.sizeBytes),
    createdAt: row.createdAt.toISOString(),
    team: row.team?.name ?? '',
    mimeType: row.mimeType,
    isFolder: row.isFolder,
    // The fixture's `folder` flag, kept alongside `isFolder` so the existing
    // components that read `folder` keep working unchanged.
    folder: row.isFolder || undefined,
    starred: row.starredBy.some((user) => user.id === viewerId),
    uploaded,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export type CalendarEventDto = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  type: 'MEETING' | 'EVENT';
  organizerId: string;
  /** Names, because every consumer renders a face or a count, never a raw id. */
  attendeeIds: string[];
  attendeeNames: string[];
  meetingId: string | null;
  location: string;
};

type EventRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  type: 'MEETING' | 'EVENT';
  location: string | null;
  organizerId: string;
  meetingId: string | null;
  attendees: Array<{ user: { id: string; name: string } }>;
  organizer: { id: string; name: string } | null;
};

export function toEventDto(row: EventRow): CalendarEventDto {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    type: row.type,
    organizerId: row.organizerId,
    // The fixture's `attendeeIds` were ids; `attendeeNames` is new and is what
    // lets a caller render "Priya, Alex and Tom" without a second request.
    attendeeIds: row.attendees.map((a) => a.user.id),
    attendeeNames: row.attendees.map((a) => a.user.name),
      meetingId: row.meetingId,
      // Non-nullable in the response because every rendering path interpolates it
      // into a sentence, and `null` there produces "in null".
      location: row.location ?? '',
    };
  }

export type AttendanceDto = {
  id: string;
  userId: string;
  /**
   * `YYYY-MM-DD` in the app timezone, not an ISO timestamp.
   *
   * The fixture used a day key and the UI compares against `localDayKey()`, so
   * sending a full timestamp would make `record.date === today` fail for every
   * record and quietly empty the punch buttons.
   */
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'PRESENT' | 'LATE' | 'REMOTE' | 'ABSENT' | 'HALF_DAY';
  overtimeMinutes: number;
};

type AttendanceRow = {
  id: string;
  userId: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: 'PRESENT' | 'LATE' | 'REMOTE' | 'ABSENT' | 'HALF_DAY';
  overtimeMinutes: number;
};

export function toAttendanceDto(row: AttendanceRow): AttendanceDto {
  return {
    id: row.id,
    userId: row.userId,
    // Prisma reads a `@db.Date` as UTC midnight, so the ISO slice is the stored day
    // rather than a local-timezone conversion that could shift it by one.
    date: dateColumnToDayKey(row.date),
    checkIn: row.checkIn ? row.checkIn.toISOString() : null,
    checkOut: row.checkOut ? row.checkOut.toISOString() : null,
    status: row.status,
    overtimeMinutes: row.overtimeMinutes,
  };
}

/**
 * A participant, as the meetings list and detail return them.
 *
 * `isOrganizer` is computed rather than sent as a separate flag, because "this person
 * ran it" is a fact about the meeting's `organizerId` and the UI would otherwise
 * have to carry it in two places.
 */
export type MeetingParticipantDto = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isOrganizer: boolean;
};

export type MeetingDto = {
  id: string;
  title: string;
  roomName: string;
  organizerId: string;
  startsAt: string;
  endsAt: string;
  participants: MeetingParticipantDto[];
  /** Count only. The array is there for the faces; the count is for the label. */
  participantCount: number;
  /**
   * Whether the meeting has ended, judged against the clock on the server.
   *
   * Sent so the client does not compute it from a clock that may disagree with the
   * one that decided which side of the list it landed on.
   */
  ended: boolean;
};

export type MeetingRow = {
  id: string;
  title: string;
  roomName: string;
  organizerId: string;
  startsAt: Date;
  endsAt: Date;
  participants: { user: { id: string; name: string; avatarUrl: string | null } }[];
};

export function toMeetingDto(row: MeetingRow): MeetingDto {
  const now = Date.now();

  return {
    id: row.id,
    title: row.title,
    roomName: row.roomName,
    organizerId: row.organizerId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    participants: row.participants.map(({ user }) => ({
      ...user,
      isOrganizer: user.id === row.organizerId,
    })),
    participantCount: row.participants.length,
    ended: row.endsAt.getTime() <= now,
  };
}

export type LeaveStatusDto = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveTypeDto = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'PARENTAL' | 'UNPAID';

/**
 * The user shape a leave row needs alongside the request itself.
 *
 * Two names, not one: an approver has to see whose request this is, and once it is
 * decided they also have to see who decided it. Embedding a single `person` would
 * force the client to guess which of the two it is looking at.
 */
export type LeavePartyDto = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type LeaveRequestDto = {
  id: string;
  userId: string;
  user: LeavePartyDto;
  type: LeaveTypeDto;
  from: string;
  to: string;
  days: number;
  reason: string | null;
  status: LeaveStatusDto;
  decidedBy: LeavePartyDto | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

/** The row shape `toLeaveRequestDto` reads, after Prisma has included both parties. */
/**
 * The row shape `toLeaveRequestDto` reads, after Prisma has included both parties.
 *
 * Hand-written rather than derived from the generated client, matching
 * `AttendanceRow` above: the DTOs are the API's contract, and tying them to the
 * client type would make a schema change silently reshape the response.
 */
type LeaveRequestRow = {
  id: string;
  userId: string;
  type: LeaveTypeDto;
  fromDate: Date;
  toDate: Date;
  days: number;
  reason: string | null;
  status: LeaveStatusDto;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  user: LeavePartyDto;
  decidedBy: LeavePartyDto | null;
};

function toLeavePartyDto(user: LeavePartyDto): LeavePartyDto {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
}

export function toLeaveRequestDto(row: LeaveRequestRow): LeaveRequestDto {
  return {
    id: row.id,
    userId: row.userId,
    user: toLeavePartyDto(row.user),
    type: row.type,
    from: row.fromDate.toISOString(),
    to: row.toDate.toISOString(),
    days: row.days,
    reason: row.reason,
    status: row.status,
    decidedBy: row.decidedBy ? toLeavePartyDto(row.decidedBy) : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}
