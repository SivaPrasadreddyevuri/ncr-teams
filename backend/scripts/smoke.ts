/**
 * End-to-end smoke test of the browser-facing flow, driven over real HTTP.
 *
 * This is not a unit test. It signs in as the API expects, uses the CSRF header
 * the way `lib/api.ts` does, and checks the responses the frontend will branch
 * on -- which is the part that unit tests of the client cannot prove.
 *
 * Run with the API already listening on API_PORT (default 4000).
 */

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';
const WS = process.env.SMOKE_WS ?? 'ws://127.0.0.1:4000/ws';

let cookie = '';

function jar() {
  return cookie;
}

function absorb(response: Response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const index = pair!.indexOf('=');
    if (index === -1) continue;
    const name = pair!.slice(0, index).trim();
    const value = pair!.slice(index + 1).trim();
    const existing = cookie.split('; ').filter(Boolean);
    const kept = existing.filter((c) => !c.startsWith(`${name}=`));
    if (value) kept.push(`${name}=${value}`);
    cookie = kept.join('; ');
  }
}

function csrf(): string | null {
  for (const part of cookie.split('; ')) {
    const [name, ...rest] = part.split('=');
    if (name === 'ncr_csrf') return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrf();
    if (token) headers['x-csrf-token'] = token;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  absorb(response);
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: response.status, json: json as Record<string, unknown> | null };
}

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n          ${detail}`}`);
}

console.log(`smoke test against ${BASE}\n`);

/* 1. a wrong password is rejected and sets no cookie */
let r = await call('POST', '/api/auth/login', { email: 'alex@company.com', password: 'nope' });
check('wrong password is 401', r.status === 401, `got ${r.status}`);
check('no session cookie was set', !cookie.includes('ncr_session='), `jar: ${cookie}`);

/* 2. the demo password works, and the cookies are right */
r = await call('POST', '/api/auth/login', { email: 'alex@company.com', password: 'showcase-2026' });
check('demo password signs in', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
check('session cookie is set', cookie.includes('ncr_session='));
check('csrf cookie is readable', csrf() !== null);

/* 3. /me identifies the caller */
r = await call('GET', '/api/auth/me');
check('me returns u1', (r.json?.user as { id?: string })?.id === 'u1', JSON.stringify(r.json));

/* 4. a state-changing call with the session cookie but no csrf header is refused.
      Issued with a raw fetch so the header really is absent -- `call()` adds it
      automatically, and filtering the jar afterwards was fiddly enough to get
      wrong and report a false pass. */
const noCsrf = await fetch(`${BASE}/api/messages`, {
  method: 'POST',
  headers: { cookie: jar(), 'content-type': 'application/json' },
  body: JSON.stringify({ channelId: 'c1', body: 'no csrf' }),
});
check('a write without csrf is 403', noCsrf.status === 403, `got ${noCsrf.status}`);

/* 5. the seeded message thread loads */
r = await call('GET', '/api/messages?channelId=c1');
const messages = (r.json?.messages ?? []) as Array<{ id: string; body: string }>;
// Presence, not an exact count: the smoke test writes and deletes a message of
// its own, and a leftover from a previous run should not read as a failure.
const seeded = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
check(
  'the six seeded messages are present',
  seeded.every((id) => messages.some((m) => m.id === id)),
  `saw ${messages.map((m) => m.id).join(',')}`,
);

/* 6. posting a message returns it and it is then listed */
r = await call('POST', '/api/messages', { channelId: 'c1', body: 'smoke test message' });
const posted = r.json?.message as { id: string; authorId: string; body: string } | undefined;
check('posting a message returns 201', r.status === 201, `got ${r.status}`);
check('the message has authorId u1', posted?.authorId === 'u1', JSON.stringify(posted));

r = await call('GET', '/api/messages?channelId=c1');
const after = r.json?.messages as Array<{ id: string; body: string }>;
check('the new message is listed', after?.some((m) => m.body === 'smoke test message'));
if (posted) await call('DELETE', `/api/messages/${posted.id}`);

/* 7. a websocket token is issued and the handshake is accepted */
r = await call('GET', '/api/auth/ws-token');
const token = r.json?.token as string | undefined;
check('ws-token is issued', typeof token === 'string' && token.length > 0, JSON.stringify(r.json));

if (token) {
  const { WebSocket } = await import('ws');
  const opened = await new Promise<boolean>((resolve) => {
    const socket = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => {
      socket.terminate();
      resolve(false);
    }, 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  check('the websocket handshake is accepted', opened);
}

/* 8. a file upload and download round trip */
const boundary = '----smoke';
const payload = 'smoke test file contents';
const body = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="file"; filename="smoke.txt"',
  'Content-Type: text/plain',
  '',
  payload,
  `--${boundary}--`,
  '',
].join('\r\n');

const upload = await fetch(`${BASE}/api/files`, {
  method: 'POST',
  headers: {
    cookie: jar(),
    'content-type': `multipart/form-data; boundary=${boundary}`,
    ...(csrf() ? { 'x-csrf-token': csrf()! } : {}),
  },
  body,
});
absorb(upload);
const uploadJson = (await upload.json().catch(() => null)) as { file?: { id: string } } | null;
check('upload returns 201', upload.status === 201, `got ${upload.status}`);
const fileId = uploadJson?.file?.id;

if (fileId) {
  const download = await fetch(`${BASE}/api/files/${fileId}/download`, {
    headers: { cookie: jar() },
  });
  const text = await download.text();
  check('download returns the exact bytes', download.status === 200 && text === payload, `got ${download.status}: ${text.slice(0, 40)}`);
  await call('DELETE', `/api/files/${fileId}`);
}

/* 9. logout invalidates the session */
r = await call('POST', '/api/auth/logout');
check('logout is 204', r.status === 204, `got ${r.status}`);
r = await call('GET', '/api/auth/me');
check('me is 401 after logout', r.status === 401, `got ${r.status}`);

console.log(failures === 0 ? '\nall smoke checks passed' : `\n${failures} smoke check(s) failed`);
// Not process.exit(): tearing the process down while a socket handle is still
// closing trips a libuv assertion on Windows and buries the real output.
process.exitCode = failures === 0 ? 0 : 1;
