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

export const api = {
  /* auth */
  /**
   * Signs in.
   *
   * Two shapes come back from the same 200. With no second factor the response
   * carries a `user`; with one enabled it carries a `challengeToken` and *no*
   * session has been issued. Both are in the union so the caller has to handle
   * the second case, rather than discovering it when nothing is authenticated.
   */
  login: (email: string, password: string) =>
    request<
      | { user: { id: string; email: string; role: Person['role'] }; challengeToken?: undefined }
      | { challengeToken: string; method: 'totp'; user?: undefined }
    >('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  loginWithTwoFactor: (challengeToken: string, code: string) =>
    request<{ user: { id: string; email: string; role: Person['role'] } }>('/auth/verify-2fa', {
      method: 'POST',
      body: { challengeToken, code },
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: { id: string; email: string; role: Person['role'] } }>('/auth/me'),
  wsToken: () =>
    request<{ token: string; expiresAt: string; expiresInSeconds: number }>('/auth/ws-token'),

  /* people and structure */
  users: () => request<{ users: Person[] }>('/users'),
  teams: () => request<{ teams: unknown[] }>('/teams'),
  channels: (teamId: string) =>
    request<{ channels: Channel[] }>(`/channels?teamId=${encodeURIComponent(teamId)}`),
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
  sendMessage: (channelId: string, body: string, attachmentIds: string[] = []) =>
    request<{ message: ChatMessage }>('/messages', {
      method: 'POST',
      body: { channelId, body, attachmentIds },
    }),
  toggleReaction: (messageId: string, emoji: string) =>
    request<{ message: ChatMessage }>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: { emoji },
    }),

  /* files */
  files: (params: { folderId?: string; team?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.folderId) query.set('folderId', params.folderId);
    if (params.team) query.set('team', params.team);
    const suffix = query.toString();
    return request<{ files: FileRow[] }>(`/files${suffix ? `?${suffix}` : ''}`);
  },
  uploadFile: (blob: Blob, name: string, extra: { folderId?: string; channelId?: string } = {}) => {
    const form = new FormData();
    form.append('file', blob, name);
    if (extra.folderId) form.append('folderId', extra.folderId);
    if (extra.channelId) form.append('channelId', extra.channelId);
    return request<{ file: FileRow }>('/files', { method: 'POST', formData: form });
  },
  starFile: (fileId: string) =>
    request<{ file: FileRow }>(`/files/${encodeURIComponent(fileId)}/star`, { method: 'POST', body: {} }),
  deleteFile: (fileId: string) =>
    request<{ deleted: boolean; id: string }>(`/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }),
  downloadUrl: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/download`,
};
