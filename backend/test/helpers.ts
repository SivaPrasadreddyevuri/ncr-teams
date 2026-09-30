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
import { createApp } from '../src/app.js';
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

  return {
    baseUrl,
    client: () => new Client(baseUrl),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await prisma.$disconnect();
    },
  };
}

/** Signs in and returns a client holding the session. */
export async function signedInClient(
  harness: Harness,
  email: string,
  password: string,
): Promise<Client> {
  const client = harness.client();
  const response = await client.post('/api/auth/login', { email, password });
  if (response.status !== 200) {
    throw new Error(
      `login failed for ${email}: ${response.status} ${await response.text()}`,
    );
  }
  return client;
}

/** Credentials the suite signs in with. See test/fixtures. */
export const TEST_PASSWORD = 'integration-test-password';

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
