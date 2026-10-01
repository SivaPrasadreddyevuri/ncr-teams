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
  authorId: string;
  body: string;
  createdAt: string;
  reactions: ReactionDto[];
  attachments: AttachmentDto[];
  /** Set once a message has been soft deleted, so the UI can show a tombstone. */
  deleted: boolean;
  editedAt: string | null;
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
  userId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
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
