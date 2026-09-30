/**
 * Test harness.
 *
 * Boots the real app on an ephemeral port and drives it over HTTP, rather than
 * calling handlers directly. That matters for the things most likely to break:
 * cookie flags, CSRF, status codes, and JSON serialisation all live in the
 * middleware and the response path, and a direct handler call would skip every
 * one of them.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { attachRealtime } from '../src/realtime/server.js';
import { prisma } from '../src/db.js';

/** One HTTP client that keeps cookies, the way a browser would. */
export class Client {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** Records Set-Cookie, including a deletion of a cookie with an empty value. */
  private absorbCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = raw.split(';');
      const index = pair!.indexOf('=');
      if (index === -1) continue;
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();

      const maxAge = attributes
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith('max-age='));
      const expired = maxAge ? Number(maxAge.split('=')[1]) <= 0 : value === '';

      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** The CSRF secret the way the frontend would read it: from the cookie jar. */
  csrfToken(): string | undefined {
    return this.cookies.get('ncr_csrf');
  }

  forgetCookies(): void {
    this.cookies.clear();
  }

  async request(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; withCsrf?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers };

    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    // Every state-changing request needs the CSRF header, exactly as the
    // frontend will send it. Off only where a test is deliberately omitting it.
    if (options.withCsrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const token = this.csrfToken();
      if (token) headers['x-csrf-token'] = token;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });

    this.absorbCookies(response);
    return response;
  }

  get(path: string, options?: { headers?: Record<string, string> }) {
    return this.request('GET', path, options);
  }
  post(path: string, body?: unknown, options?: { withCsrf?: boolean; headers?: Record<string, string> }) {
    return this.request('POST', path, { body, ...options });
  }
  patch(path: string, body?: unknown, options?: { withCsrf?: boolean }) {
    return this.request('PATCH', path, { body, ...options });
  }
  delete(path: string, options?: { withCsrf?: boolean }) {
    return this.request('DELETE', path, options);
  }

  /**
   * GET returning the parsed body.
   *
   * For the happy paths, where the status is not the thing under test. Where the
   * status or headers matter, use `get` and `readJson` so the assertion can see
   * them.
   */
  async getJson<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
    const response = await this.get(path, options);
    assert2xx(response, path);
    return readJson<T>(response);
  }

  async postJson<T>(path: string, body?: unknown, options?: { withCsrf?: boolean }): Promise<T> {
    const response = await this.post(path, body, options);
    assert2xx(response, path);
    return readJson<T>(response);
  }

  /**
   * Multipart upload.
   *
   * `FormData` is passed straight to fetch, which sets `content-type` itself
   * including the boundary. Setting it by hand as `multipart/form-data` omits the
   * boundary, and the server then cannot find where the body starts -- which
   * looks like a malformed request rather than a missing header.
   */
  async upload(
    path: string,
    form: FormData,
    options: { withCsrf?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    if (options.withCsrf !== false) {
      const token = this.csrfToken();
      if (token) headers['x-csrf-token'] = token;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: form,
      redirect: 'manual',
    });
    this.absorbCookies(response);
    return response;
  }
}

/** Fails loudly with the body, which a bare `await response.json()` would not. */
function assert2xx(response: Response, path: string): void {
  if (response.ok) return;
  throw new Error(
    `${path} returned ${response.status}: ${response.statusText}. Body: ${response.status === 204 ? '(empty)' : 'see console'}`,
  );
}

export type Harness = {
  baseUrl: string;
  /** A fresh client with no cookies. */
  client: () => Client;
  /**
   * A signed-in client for `email`, memoised per user.
   *
   * Memoised because the service enforces a single session per user: signing in
   * again revokes the previous session. Without this, a test that signs in once
   * for an HTTP call and again to open a socket silently invalidates its own HTTP
   * client, and the failure shows up as a 401 several steps later with nothing
   * pointing at the cause.
   */
  signIn: (email: string, password: string) => Promise<Client>;
  /** The public WebSocket URL, without a token. */
  wsUrl: string;
  /** WebSocket connections currently open, for assertions. */
  wsConnectionCount: () => number;
  close: () => Promise<void>;
};

/** Starts the app on an ephemeral port. Port 0 lets the OS choose. */
export async function startHarness(): Promise<Harness> {
  const app = createApp();

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // The WebSocket is attached to the same server here as in server.ts, so the
  // handshake path under test is the real one rather than a stub.
  const realtime = attachRealtime(server);

  const signedIn = new Map<string, Client>();

  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    wsConnectionCount: realtime.connectionCount,
    client: () => new Client(baseUrl),
    signIn: async (email, password) => {
      const existing = signedIn.get(email);
      if (existing) return existing;
      const created = await signInAt(baseUrl, email, password);
      signedIn.set(email, created);
      return created;
    },
    close: async () => {
      await realtime.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await prisma.$disconnect();
    },
  };
}

/** Signs in against `baseUrl` and returns a client holding the session. */
export async function signInAt(baseUrl: string, email: string, password: string): Promise<Client> {
  const client = new Client(baseUrl);
  const response = await client.post('/api/auth/login', { email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`);
  }
  return client;
}

/** As `signInAt`, against an existing harness. */
export async function signedInClient(
  harness: Harness,
  email: string,
  password: string,
): Promise<Client> {
  return signInAt(harness.baseUrl, email, password);
}

/** Credentials the suite signs in with. See test/fixtures. */
export const TEST_PASSWORD = 'integration-test-password';

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

export type WsFrame = { type: string; payload: Record<string, unknown> };

/**
 * A WebSocket client that records every frame it receives.
 *
 * Frames are buffered rather than awaited one at a time, because the interesting
 * assertions are about what a *second* client receives, and a test that pulls
 * frames off a queue in order would couple itself to delivery timing.
 */
export class WsClient {
  private readonly received: WsFrame[] = [];
  private readonly socket: WebSocket;
  private readonly waiters: Array<{
    match: (frame: WsFrame) => boolean;
    resolve: (frame: WsFrame) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(raw.toString()) as WsFrame;
      } catch {
        return;
      }
      this.received.push(frame);

      // Resolve any waiter this frame satisfies, oldest first.
      for (let i = 0; i < this.waiters.length; i += 1) {
        const waiter = this.waiters[i]!;
        if (waiter.match(frame)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve(frame);
          return;
        }
      }
    });
  }

  /** Opens a socket, failing rather than hanging if the handshake is rejected. */
  static connect(url: string, options: { timeoutMs?: number } = {}): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`WebSocket did not open within ${options.timeoutMs ?? 5000}ms`));
      }, options.timeoutMs ?? 5000);

      socket.once('open', () => {
        clearTimeout(timer);
        resolve(new WsClient(socket));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        reject(new Error(`handshake rejected with ${response.statusCode}`));
      });
    });
  }

  send(type: string, payload: unknown = {}): void {
    this.socket.send(JSON.stringify({ type, payload }));
  }

  /** Sends bytes verbatim, for the malformed-frame cases. */
  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  /** The first frame of `type` ever received, or undefined. */
  first(type: string): WsFrame | undefined {
    return this.received.find((frame) => frame.type === type);
  }

  all(type: string): WsFrame[] {
    return this.received.filter((frame) => frame.type === type);
  }

  get frames(): WsFrame[] {
    return this.received;
  }

  /**
   * Waits for a frame matching `match`.
   *
   * Checks what has already arrived before waiting, so a test that asserts on a
   * frame which landed during setup does not deadlock against its own buffer.
   */
  waitFor(match: (frame: WsFrame) => boolean, timeoutMs = 5000): Promise<WsFrame> {
    const already = this.received.find(match);
    if (already) return Promise.resolve(already);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.timer === timer);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for a frame. Received: ${JSON.stringify(
              this.received.map((f) => f.type),
            )}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ match, resolve, reject, timer });
    });
  }

  waitForType(type: string, timeoutMs = 5000): Promise<WsFrame> {
    return this.waitFor((frame) => frame.type === type, timeoutMs);
  }

  /** Resolves false if no frame of `type` arrives within the window. */
  async seesNo(type: string, windowMs = 300): Promise<boolean> {
    try {
      await this.waitForType(type, windowMs);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.socket.close();
  }

  terminate(): void {
    this.socket.terminate();
  }
}

/* ------------------------------------------------------------------ */
/* Response shapes                                                      */
/* ------------------------------------------------------------------ */

/*
 * Declared here rather than cast at each call site, so the suite states the
 * contract it expects instead of asserting on `unknown`. Each mirrors
 * `frontend/lib/data.ts`, which is the point: if the API drifts from the
 * fixtures, these should stop matching.
 */

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

/* ------------------------------------------------------------------ */
/* Typed JSON access                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parses a response body.
 *
 * `Response.json()` is typed `unknown`, so without a generic here every field
 * access in a test would need a cast and a typo in a field name would silently
 * compare against `undefined`.
 */
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
