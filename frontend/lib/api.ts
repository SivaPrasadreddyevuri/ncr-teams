/**
 * The API client.
 *
 * One place that talks to the backend, so the CSRF token is read once, cookies
 * are sent once, and a 401 is handled once.
 *
 * ## Same-origin by proxying
 *
 * Requests go to `/api/...` on this app's own host, never to the backend's host.
 * `next.config.ts` rewrites that prefix to the backend, so from the browser the
 * two are the same origin. That is what lets an `httpOnly`, `SameSite=Lax`
 * session cookie work at all — a cross-origin request would need
 * `SameSite=None; Secure`, which would reopen CSRF on every route.
 *
 * The backend's CORS middleware is therefore development-only, for the case
 * where the two are genuinely on different ports.
 */

/** Thrown for any non-2xx response. Carries the backend's `error.code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the session is gone and the user has to sign in again. */
  get isUnauthorised(): boolean {
    return this.status === 401;
  }
}

/**
 * The CSRF secret, read from the cookie the server set.
 *
 * `ncr_csrf` is deliberately not `httpOnly` — the frontend has to read it to
 * echo it back in a header, which is the whole double-submit pattern. Read at
 * call time rather than at module load, because this module is imported during
 * prerendering when `document` does not exist.
 */
function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'ncr_csrf') return decodeURIComponent(rest.join('='));
  }
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Set for FormData, which must supply its own content-type with a boundary. */
  formData?: FormData;
  signal?: AbortSignal;
};

/**
 * Calls the backend.
 *
 * ## This is browser-only, and a page that needs data must be a client component
 *
 * The URL is relative on purpose -- same-origin, so the httpOnly session cookie
 * rides along and there is no cross-site cookie anywhere.
 *
 * The consequence is that this cannot run in a server component. A server
 * component has no origin to resolve `/api/...` against and, more fundamentally,
 * no access to the session cookie: it lives on the browser's jar. So it cannot
 * call an authenticated endpoint on the user's behalf, no matter what base URL the
 * server is given. Pointing it at `API_ORIGIN` would produce a request as
 * *nobody*.
 *
 * It does not throw, either, which is what makes this expensive to rediscover: a
 * server component that awaits one of these hangs rather than failing, so
 * `next build` spends 60 seconds per page retrying and then gives up with "took
 * more than 60 seconds" -- which reads like a slow page, not a wrong architecture.
 *
 * Fetching server-side is the right call for a *public* endpoint, and there is
 * none yet. When there is, this function should grow an absolute-URL branch for
 * server callers rather than every page being made a client component forever.
 *
 * Until then, every screen that needs data is a client component using
 * `useApiData`, whose fallback chain is live API -> cache -> seed. The route files
 * stay server components wrapping them in a `<Screen />`, so a page can still gain
 * a server-rendered heading without unpicking its data fetching. Examples:
 * `components/activity/ActivityScreen.tsx`, `components/calendar/CalendarScreen.tsx`,
 * and `components/home/HomeEventsProvider.tsx` for the case where two siblings
 * need one fetch.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.formData) {
    // content-type is deliberately left unset: fetch adds it with the multipart
    // boundary. Setting it by hand omits the boundary and the server cannot find
    // where the body starts.
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  // Safe methods need no token, and neither does a request with no session: a
  // request without the session cookie cannot act as the signed-in user.
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    // Same-origin, so the httpOnly session cookie rides along.
    credentials: 'same-origin',
    body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or a crashed instance. Surfaced as a generic
      // error rather than a parse failure, because the status is the useful part.
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? `Request failed with ${response.status}`,
    );
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export type Person = {
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

export type Channel = {
  id: string;
  name: string;
  teamName: string;
  teamId: string;
  lastMessage: string;
  lastAt: string | null;
  unread: number;
  memberIds: string[];
};

/**
 * One search hit.
 *
 * `snippet` is server-rendered text with the matched words wrapped in `<mark>`
 * by `ts_headline`, because only the database knows which words the tsquery
 * actually matched. The page turns those markers into elements -- it is never
 * passed to dangerouslySetInnerHTML, since the surrounding text is
 * user-authored and this page has no sanitisation step.
 */
export type SearchResult = {
  id: string;
  scope: 'people' | 'messages' | 'files' | 'events' | 'teams';
  title: string;
  detail: string;
  context: string;
  href: string;
  snippet: string | null;
  stamp: string | null;
  rank: number;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  reactions: Array<{ emoji: string; userIds: string[] }>;
  attachments: Array<{ id: string; name: string; size: number; type: string }>;
  deleted: boolean;
  editedAt: string | null;
  /**
   * The message this one replies to, or null.
   *
   * Replies render inline rather than in a side panel, so the parent travels with
   * the message: rendering "Replying to Sarah" needs no second request per reply on
   * screen.
   */
  parentId: string | null;
  /**
   * The parent's author name, resolved server-side. Null when there is no parent.
   *
   * Kept when the parent is deleted: the reply genuinely was in reply to something
   * that person wrote, so attributing it is correct. The UI shows the parent as
   * deleted text, as Discord and Slack do.
   */
  parentAuthor: string | null;
};

export type FileRow = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  team: string;
  mimeType: string;
  isFolder: boolean;
  folder?: boolean;
  starred: boolean;
  uploaded: boolean;
  deletedAt: string | null;
};

export type Team = {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  memberCount: number;
  channelCount: number;
  mine: boolean;
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

export type Department = {
  id: string;
  name: string;
  description: string;
  head: string;
  members: number;
};

export type ActivityTarget =
  | { kind: 'message'; id: string; body: string; channelName: string | null }
  | { kind: 'file'; id: string; name: string; sizeBytes: string }
  | { kind: 'meeting'; id: string; title: string; startsAt: string }
  | { kind: 'leave'; id: string; status: string; days: number; from: string; to: string }
  | null;

export type ActivityItem = {
  id: string;
  kind: 'MESSAGE' | 'FILE' | 'MEETING' | 'LEAVE' | 'MENTION';
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null } | null;
  target: ActivityTarget;
};

export const api = {
  /* auth */
  /**
   * Signs in.
   *
   * Always returns a user and sets a session. Two-factor was removed: the login
   * challenge was unreachable because nothing could enable the factor.
   */
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string; role: Person['role'] } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  /**
   * The signed-in user.
   *
   * Takes an `AbortSignal` because every read on this screen is cancellable and this
   * one is no different -- without it the signal has to be threaded through a bespoke
   * `fetch` here, which is the same request typed twice.
   */
  me: (signal?: AbortSignal) =>
    request<{ user: { id: string; email: string; role: Person['role'] } }>('/auth/me', { signal }),
  wsToken: () =>
    request<{ token: string; expiresAt: string; expiresInSeconds: number }>('/auth/ws-token'),

  /* people and structure */

  /**
   * Updates the signed-in user's own profile.
   *
   * The server's schema is strict, so an unknown key is a 400. `department` and
   * `email` are deliberately not sent from the settings form: the first is a
   * foreign key reached through a name, the second is the login identity. An
   * empty string is sent as `null`, because the server treats '' as invalid for
   * the nullable text fields and `null` is how a field is cleared.
   */
  updateMyProfile: (patch: {
    name?: string;
    jobTitle?: string | null;
    phone?: string | null;
    bio?: string | null;
  }) =>
    request<{ user: Person }>('/users/me', {
      method: 'PATCH',
      body: Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [key, value === '' ? null : value]),
      ),
    }),

  users: (signal?: AbortSignal) => request<{ users: Person[] }>('/users', { signal }),
  teams: (signal?: AbortSignal) => request<{ teams: Team[] }>('/teams', { signal }),
  /**
   * Channels across several teams, in parallel.
   *
   * There is deliberately no single-team variant. `GET /channels` requires a
   * `teamId` on purpose: an unfiltered listing would hand back channels from
   * teams the caller is not in, and the guard against that is the parameter
   * itself. Every screen that needs channels wants several teams, so the
   * fan-out is the only shape offered.
   */
  channelsForTeams: async (teamIds: string[], signal?: AbortSignal): Promise<Channel[]> => {
    if (teamIds.length === 0) return [];
    const results = await Promise.all(
      teamIds.map((teamId) => request<{ channels: Channel[] }>(
        `/channels?teamId=${encodeURIComponent(teamId)}`,
        { signal },
      )),
    );
    return results.flatMap((result) => result.channels);
  },
  departments: (signal?: AbortSignal) =>
    request<{ departments: Department[] }>('/departments', { signal }),
  // `activity` is defined once, further down beside the other feed/search calls.
  markChannelRead: (channelId: string) =>
    request<{ lastReadAt: string }>(`/channels/${encodeURIComponent(channelId)}/read`, {
      method: 'POST',
      body: {},
    }),

  /* messages */
  messages: (channelId: string, before?: string) => {
    const query = new URLSearchParams({ channelId, limit: '50' });
    if (before) query.set('before', before);
    return request<{ messages: ChatMessage[]; nextCursor: string | null }>(`/messages?${query}`);
  },
  /**
   * Send a message.
   *
   * `parentId` makes it a reply. The server validates that the parent is in the
   * same channel, because a reply spanning two conversations is a thread that
   * belongs to neither.
   */
  sendMessage: (channelId: string, body: string, attachmentIds: string[] = [], parentId?: string) =>
    request<{ message: ChatMessage }>('/messages', {
      method: 'POST',
      body: { channelId, body, attachmentIds, ...(parentId ? { parentId } : {}) },
    }),
  toggleReaction: (messageId: string, emoji: string) =>
    request<{ message: ChatMessage }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: { emoji },
    }),

  /**
   * Edit a message.
   *
   * Author-only and server-trimmed, so the trimmed body comes back in the
   * response rather than being recomputed here -- the server's copy is the one that
   * was stored.
   */
  editMessage: (messageId: string, body: string) =>
    request<{ message: ChatMessage }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: { body },
    }),

  /** Soft delete. The row stays as a tombstone so replies keep their position. */
  deleteMessage: (messageId: string) =>
    request<{ message: ChatMessage }>(`/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
    }),

  /* files */
  files: (params: { folderId?: string; team?: string; channelId?: string; meetingId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.folderId) query.set('folderId', params.folderId);
    if (params.team) query.set('team', params.team);
    // Added for the chat sidebar's Files tab, which asks "what was shared here".
    if (params.channelId) query.set('channelId', params.channelId);
    // The same question asked of a call. Scoped server-side by participation, so this
    // returns nothing for a meeting you are not in rather than confirming it exists.
    if (params.meetingId) query.set('meetingId', params.meetingId);
    const suffix = query.toString();
    return request<{ files: FileRow[] }>(`/files${suffix ? `?${suffix}` : ''}`);
  },
  uploadFile: (blob: Blob, name: string, extra: { folderId?: string; channelId?: string; meetingId?: string } = {}) => {
    const form = new FormData();
    form.append('file', blob, name);
    if (extra.folderId) form.append('folderId', extra.folderId);
    if (extra.channelId) form.append('channelId', extra.channelId);
    if (extra.meetingId) form.append('meetingId', extra.meetingId);
    return request<{ file: FileRow }>('/files', { method: 'POST', formData: form });
  },
  starFile: (fileId: string) =>
    request<{ file: FileRow }>(`/files/${encodeURIComponent(fileId)}/star`, { method: 'POST', body: {} }),
  deleteFile: (fileId: string) =>
    request<{ deleted: boolean; id: string }>(`/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }),
  downloadUrl: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/download`,

  /* search */
  /**
   * Ranked search across people, messages, files, events and teams.
   *
   * `scope` is sent rather than filtered client-side, so the counts per scope and
   * the results list come from the same ranking. Filtering after the fact would
   * show a count of N next to a list of three, because the limit was already
   * spent on the other scopes.
   */
  search: (params: { q: string; scope?: string; limit?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ q: params.q });
    if (params.scope) query.set('scope', params.scope);
    if (params.limit) query.set('limit', String(params.limit));
    return request<{
      results: SearchResult[];
      /** Every scope, including the zeroes, and not filtered by `scope`. */
      counts: Record<SearchResult['scope'], number>;
      query: string;
      scope: string;
    }>(`/search?${query}`, { signal });
  },

  /* stats */
  /**
   * Dashboard and launcher counts, in one round trip.
   *
   * Both blocks come from a single response because they are the same query, and
   * two calls would render four cards and five badges from six table counts.
   *
   * `dashboard.messages` is *unread*, not total, and it is computed against each
   * channel's own read marker -- so it agrees with the sidebar badge by
   * construction rather than by coincidence.
   */
  stats: (signal?: AbortSignal) =>
    request<{
      dashboard: { messages: number; meetings: number; mentions: number };
      apps: {
        channels: number;
        events: number;
        files: number;
        meetings: number;
        attendance: number;
      };
    }>('/stats', { signal }),

  /* attendance */
  /**
   * The caller's own attendance for a window.
   *
   * There is no `userId` parameter. An HR board wants to see a whole team, and that
   * needs a scope rule and its own decision about who may use it -- so it is a
   * separate endpoint rather than a flag here that looks already built.
   */
  attendance: (
    params: { from?: string; to?: string; days?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.days) query.set('days', String(params.days));
    const suffix = query.toString();
    return request<{
      records: AttendanceRecordDto[];
      from: string;
      to: string;
      /** The server's thresholds, so the client does not hardcode them. */
      rules: { lateAfterMinutes: number; overtimeAfterMinutes: number };
    }>(`/attendance${suffix ? `?${suffix}` : ''}`, { signal });
  },

  /**
   * Check in or out for today.
   *
   * Sends only which button was pressed. `status` and `overtimeMinutes` are derived
   * server-side and returned, so a client cannot claim it arrived on time at 23:00.
   */
  punch: (action: 'in' | 'out') =>
    request<{ record: AttendanceRecordDto }>('/attendance/punch', {
      method: 'POST',
      body: { action },
    }),

  /* leave */
  /**
   * The signed-in user's own leave requests.
   *
   * No `userId` parameter, matching the server: a leave request is a statement
   * someone makes about their own availability, so reading anyone else's is a
   * different question with its own endpoint and its own role check.
   */
  myLeave: (
    params: { status?: LeaveStatusDto; days?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.days) query.set('days', String(params.days));
    const suffix = query.toString();
    return request<{ requests: LeaveRequestDto[] }>(
      `/leave${suffix ? `?${suffix}` : ''}`,
      { signal },
    );
  },

  /**
   * Files a leave request for yourself.
   *
   * There is deliberately no `userId` in `body`, and no `days` either: the count is
   * a column the server derives from the window, so a client that supplied it would
   * be supplying the number an approver reads. The server rejects both keys.
   */
  fileLeave: (body: { type: LeaveTypeDto; from: string; to: string; reason?: string }) =>
    request<{ request: LeaveRequestDto }>('/leave', { method: 'POST', body }),

  /**
   * Withdraws one of your own pending requests.
   *
   * Separate from the HR decision because the two are not the same act: this one is
   * the requester changing their mind, the other is someone with the authority to
   * approve time off.
   */
  cancelLeave: (id: string) =>
    request<{ request: LeaveRequestDto }>(`/leave/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: {},
    }),

  /**
   * HR's queue. Pending by default.
   *
   * Refused with a 403 for anyone who is not HR, so this is only called from a
   * screen that has already established the role -- see `RoleGate`.
   */
  leaveQueue: (status: LeaveStatusDto = 'PENDING', signal?: AbortSignal) =>
    request<{ requests: LeaveRequestDto[]; status: LeaveStatusDto }>(
      `/leave/requests/queue?status=${encodeURIComponent(status)}`,
      { signal },
    ),

  /**
   * Approves or rejects a request.
   *
   * `decidedBy` and `decidedAt` are not in `body` and cannot be: the record of who
   * decided is taken from the session, so a client cannot file a decision in
   * someone else's name.
   */
  decideLeave: (id: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
    request<{ request: LeaveRequestDto }>(
      `/leave/requests/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: note && note.length > 0 ? { status, note } : { status },
      },
    ),

  /* meetings */
  /**
   * Meetings the caller is a participant in.
   *
   * `scope` is `upcoming` by default because that is what a meetings screen opens
   * on. Note that `upcoming` includes a meeting already in progress -- it filters on
   * `endsAt`, not `startsAt` -- so a running call is still listed and still joinable.
   *
   * This is deliberately not derived from `/events`. A MEETING row on the calendar
   * carries no `roomName`, no participant list and no transcript, and a call history
   * reads all three.
   */
  meetings: (
    params: { scope?: 'upcoming' | 'past' | 'all'; days?: number; limit?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (params.scope) query.set('scope', params.scope);
    if (params.days) query.set('days', String(params.days));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request<{
      meetings: MeetingDto[];
      scope: string;
      /** When the past/upcoming boundary was drawn, so the client need not guess. */
      evaluatedAt: string;
    }>(`/meetings${suffix ? `?${suffix}` : ''}`, { signal });
  },

  /**
   * One meeting, with its participants and recent transcript.
   *
   * `messagesTruncated` is returned rather than inferred from the page length, so a
   * transcript that happens to be exactly at the cap is not reported as complete.
   */
  meeting: (id: string, signal?: AbortSignal) =>
    request<{
      meeting: MeetingDto;
      messages: {
        id: string;
        body: string;
        createdAt: string;
        author: { id: string; name: string };
      }[];
      messagesTruncated: boolean;
    }>(`/meetings/${encodeURIComponent(id)}`, { signal }),

  /**
   * Mints a short-lived LiveKit join token for one meeting.
   *
   * POST rather than GET, so a credential that can join a room never lands in a URL
   * where a proxy or an access log would keep it. Five-minute TTL, scoped by the
   * server to the caller's own participation -- calling this for a meeting you are not
   * in is a 404.
   *
   * A `livekit_not_configured` error means the deployment has no credentials. That is
   * a supported state rather than a failure: the caller falls back to a labelled
   * simulated room.
   */
  meetingToken: (meetingId: string) =>
    request<{ token: string; expiresAt: string; expiresInSeconds: number; roomName: string }>(
      `/meetings/${encodeURIComponent(meetingId)}/token`,
      { method: 'POST', body: {} },
    ),

  /**
   * Opens, or rejoins, a channel's call.
   *
   * Takes a channel rather than a time because the call button in a channel header has
   * no start time to send. The server derives the room from the channel, so calling
   * this twice returns the same meeting with `created: false` rather than a second
   * room nobody could find.
   */
  startChannelCall: (channelId: string) =>
    request<{ meeting: MeetingDto; created: boolean }>('/meetings', {
      method: 'POST',
      body: { channelId },
    }),

  /**
   * Whether a channel has a call open right now.
   *
   * Needed because the caller's own meeting list is participant-scoped: someone who
   * has not joined yet is not in it, so the Meetings tab would report no call while
   * one is plainly running. Gated on channel membership server-side -- a channel's
   * call is visible to the channel, not just to the people already in it.
   *
   * 404 when there is no call, which is a real answer rather than a failure.
   */
  channelCall: (channelId: string, signal?: AbortSignal) =>
    request<{ meeting: MeetingDto }>(`/meetings/channel/${encodeURIComponent(channelId)}`, {
      signal,
    }),

  /**
   * The in-call transcript, paginated.
   *
   * Separate from the channel thread on purpose: meeting chat is a different
   * conversation with different permissions, and widening one endpoint to accept both
   * ids would make every scoping question ambiguous.
   */
  meetingMessages: (
    meetingId: string,
    params: { before?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) => {
    const search = new URLSearchParams();
    if (params.before) search.set('before', params.before);
    if (params.limit) search.set('limit', String(params.limit));
    const suffix = search.toString();
    return request<{ messages: MeetingMessageDto[]; nextCursor: string | null }>(
      `/meetings/${encodeURIComponent(meetingId)}/messages${suffix ? `?${suffix}` : ''}`,
      { signal },
    );
  },

  /** Posts to the in-call transcript. Persisted, and delivered over the socket. */
  sendMeetingMessage: (meetingId: string, body: string) =>
    request<{ message: MeetingMessageDto }>(
      `/meetings/${encodeURIComponent(meetingId)}/messages`,
      { method: 'POST', body: { body } },
    ),

  /* events */
  /**
   * Calendar events in a window.
   *
   * The window is passed rather than a `days` count, so a caller asking for "this
   * week" sends the week it means. An `allEvents` shorthand is offered for the
   * screens that genuinely want the default horizon.
   */
  events: (
    params: { from?: string; to?: string; days?: number; limit?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.days) query.set('days', String(params.days));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request<{ events: CalendarEventDto[]; from: string; to: string }>(
      `/events${suffix ? `?${suffix}` : ''}`,
      { signal },
    );
  },

  /**
   * The activity feed.
   *
   * Note what is *not* here: the fixture's `title` and `subtitle`. Those were prose
   * frozen at seed time, so they go stale the moment anything is renamed. The feed
   * is composed from `actor` and `target` in `composeActivity`, which is real work
   * rather than a type alias -- which is why `ActivityItem` is not shared between
   * the fixture and the API.
   */
  activity: (limit = 20, before?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    return request<{ activity: ActivityRow[]; nextCursor: string | null }>(`/activity?${query}`, {
      signal,
    });
  },
};

/**
 * An attendance record as the API returns it.
 *
 * Structurally the fixture's `AttendanceRecord`, and deliberately so: the board
 * renders it unchanged. The one field that looks redundant -- `date` as a
 * `YYYY-MM-DD` key rather than a timestamp -- is what lets the component keep
 * comparing against `localDayKey()`. A full ISO timestamp there would make
 * `record.date === today` false for every record, and the punch buttons would sit
 * permanently in the "not checked in" phase with no error to explain it.
 */
/**
 * A leave request as the API returns it.
 *
 * The server sends both parties as objects rather than ids, because the HR board
 * renders a name and an avatar per row and the alternative is a second request per
 * person. `decidedBy` is null until someone decides, which is what distinguishes a
 * pending row from a decided one in the response as well as in the UI.
 *
 * `from` and `to` are full ISO instants, not bare dates: the form has always
 * supported a window inside a day ("09:00 to 17:00 on the 14th"), and a date-only
 * string would truncate the time the user typed.
 */
/**
 * A meeting, as the API returns it.
 *
 * Participants are joined rather than returned as ids, because every consumer
 * renders faces. `participantCount` is sent alongside because the label reads
 * "3 participants" and the caller should not have to measure the array.
 *
 * `ended` is the server's judgement, not something the client recomputes from its own
 * clock: the server is what decided which side of the list this landed on, so letting
 * the browser decide again invites the two to disagree.
 */
export type MeetingDto = {
  id: string;
  title: string;
  roomName: string;
  organizerId: string;
  startsAt: string;
  endsAt: string;
  participants: { id: string; name: string; avatarUrl: string | null; isOrganizer: boolean }[];
  participantCount: number;
  ended: boolean;
};

/**
 * A message in the in-call transcript.
 *
 * Structurally the channel thread's message, so one component can render both. The
 * distinction is `meetingId` rather than an empty `channelId`: a room has to be able
 * to tell the two apart, and the socket relay routes on exactly this field.
 */
export type MeetingMessageDto = {
  id: string;
  body: string;
  authorId: string;
  meetingId: string | null;
  channelId: string;
  createdAt: string;
  deleted: boolean;
  editedAt: string | null;
  parentId: string | null;
  parentAuthor: string | null;
};

export type LeaveStatusDto = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveTypeDto = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'PARENTAL' | 'UNPAID';

export type LeaveRequestDto = {
  id: string;
  userId: string;
  user: { id: string; name: string; avatarUrl: string | null };
  /**
   * A union, not `string`, so a status read off the wire cannot be assigned into a
   * `Record<LeaveRequest['status'], ...>` map and quietly fall off its end. The
   * server's schema is an enum, so a value outside this set is a bug, not a case to
   * handle at runtime.
   */
  type: LeaveTypeDto;
  from: string;
  to: string;
  days: number;
  reason: string | null;
  status: LeaveStatusDto;
  decidedBy: { id: string; name: string; avatarUrl: string | null } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type AttendanceRecordDto = {
  id: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'PRESENT' | 'LATE' | 'REMOTE' | 'ABSENT' | 'HALF_DAY';
  overtimeMinutes: number;
};

/** A calendar event as the API returns it. Replaces the fixture's CalendarEvent. */
export type CalendarEventDto = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  type: 'MEETING' | 'EVENT';
  organizerId: string;
  attendeeIds: string[];
  /** Names as well as ids, so a row can render "3 people" or a face without a join. */
  attendeeNames: string[];
  meetingId: string | null;
  location: string;
};

/** One feed row: who did something, to what. Never prose. */
export type ActivityRow = {
  id: string;
  kind: 'message' | 'file' | 'meeting' | 'leave';
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null } | null;
  /**
   * Null when the thing the notification points at has been deleted, or its type
   * was added after the API was written. Null is honest; a placeholder title
   * would be a lie.
   */
  target:
    | { kind: 'message'; id: string; body: string; channelName: string | null }
    | { kind: 'file'; id: string; name: string; sizeBytes: string }
    | { kind: 'meeting'; id: string; title: string; startsAt: string }
    | { kind: 'leave'; id: string; status: string; days: number; from: string; to: string }
    | null;
};

/** What to say when the thing a notification pointed at is gone. */
const REMOVED: Record<ActivityRow['kind'], string> = {
  message: 'A message was removed',
  file: 'A shared file was removed',
  meeting: 'A meeting was removed',
  leave: 'A leave request was removed',
};

/**
 * Turns a structured feed row into the sentence the UI shows.
 *
 * This is the work the fixture's frozen `title`/`subtitle` used to do at seed
 * time. Composing here rather than storing means renaming a channel updates every
 * feed row that mentions it, rather than leaving a stale name in a string column.
 *
 * The switch is on `target.kind`, not `row.kind`. The two are correlated in
 * practice -- a message notification points at a message -- but that correlation
 * is not something the type system can express across two separate unions, so
 * narrowing on `row.kind` would leave `target` un-narrowed and every property
 * access an error. The API already guarantees the pairing, and `REMOVED` covers
 * the case where the target is gone.
 *
 * `deletedTarget` is returned rather than a fake name because the honest answer to
 * "this pointed at something that no longer exists" is to say so.
 */
export function composeActivity(row: ActivityRow): {
  title: string;
  subtitle: string;
  deletedTarget: boolean;
} {
  const who = row.actor?.name ?? 'Someone';
  const target = row.target;

  if (!target) {
    return { title: REMOVED[row.kind], subtitle: '', deletedTarget: true };
  }

  switch (target.kind) {
    case 'message': {
      const where = target.channelName ? ` in #${target.channelName}` : '';
      return {
        title: `${who} sent a message${where}`,
        // Truncated here rather than in the response, so the sentence can never
        // overflow the row however long the message is.
        subtitle: target.body.length > 90 ? `${target.body.slice(0, 90)}…` : target.body,
        deletedTarget: false,
      };
    }
    case 'file':
      return {
        title: `${who} shared a file`,
        subtitle: target.name,
        deletedTarget: false,
      };
    case 'meeting':
      return {
        title: 'Meeting starting soon',
        subtitle: target.title,
        deletedTarget: false,
      };
    case 'leave':
      return {
        title: `Leave ${target.status}`,
        subtitle: `${who} · ${target.days} day${target.days === 1 ? '' : 's'}`,
        deletedTarget: false,
      };
    default:
      return { title: 'Something happened', subtitle: '', deletedTarget: false };
  }
}
