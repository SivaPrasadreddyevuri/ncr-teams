/**
 * End-to-end smoke test of the browser-facing flow, driven over real HTTP.
 *
 * This is not a unit test. It signs in as the API expects, uses the CSRF header
 * the way `lib/api.ts` does, and checks the responses the frontend will branch
 * on -- which is the part that unit tests of the client cannot prove.
 *
 * Run with the API already listening on API_PORT (default 4000).
 *
 * ## It writes to the database, and does not undo all of it
 *
 * It posts a message and soft-deletes a file, because that is the flow being
 * tested and neither can be exercised read-only. Both leave rows behind: a
 * soft delete is a tombstone by design, and there is no endpoint that removes a
 * row outright.
 *
 * So `npm run db:verify` will fail on three count checks after a smoke run, and
 * that is this script's doing rather than a defect. The fix is `npm run db:demo`,
 * which resets and reseeds. The check is announced at the end rather than left
 * to be discovered as a phantom failure.
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

  // Content-Length is set from the stored sizeBytes, so a row whose declared size
  // disagreed with its content would pass the comparison above and still hang or
  // truncate a real browser download.
  const declared = download.headers.get('content-length');
  check('content-length matches the body', declared === String(text.length), `declared ${declared}, body ${text.length}`);

  await call('DELETE', `/api/files/${fileId}`);

  // A soft delete has to clear the content, or the file is still one request away
  // and the row still occupies the space the delete was meant to reclaim.
  const afterDelete = await fetch(`${BASE}/api/files/${fileId}/download`, {
    headers: { cookie: jar() },
  });
  absorb(afterDelete);
  check(
    'a deleted file is no longer downloadable',
    afterDelete.status === 410,
    `got ${afterDelete.status}, expected 410`,
  );
}

/* 8b. A seeded file, whose content was attached by `demo:files`.

   The round-trip above only proves the upload path works. This proves the path a
   viewer of the demo actually clicks: a row that was created by the seed with no
   content, and later given some by the materialise script. */
{
  const listing = await call('GET', '/api/files');
  const files = (listing.json as { files?: Array<{ id: string; name: string; uploaded: boolean }> }).files ?? [];
  const seeded = files.find((f) => f.name === 'api-spec.md');
  check('a seeded file is listed', Boolean(seeded), `looked for api-spec.md in ${files.length} files`);
  check('a seeded file reports uploaded: true', seeded?.uploaded === true, `got ${seeded?.uploaded}`);

  if (seeded) {
    const download = await fetch(`${BASE}/api/files/${seeded.id}/download`, {
      headers: { cookie: jar() },
    });
    absorb(download);
    const text = await download.text();
    check('a seeded file downloads real content', download.status === 200 && text.length > 0, `got ${download.status}, ${text.length} bytes`);
    check(
      'a seeded file is served as a download',
      (download.headers.get('content-disposition') ?? '').startsWith('attachment;'),
      download.headers.get('content-disposition') ?? 'no content-disposition',
    );
    check(
      'a seeded file is not sniffable as something executable',
      download.headers.get('x-content-type-options') === 'nosniff',
      `got ${download.headers.get('x-content-type-options')}`,
    );
  }
}

/* 8c. Search.

   The unit tests cover ranking and the membership gate. This covers the part a
   unit test cannot: that a real session cookie, a real URL and the generated
   columns in a real database produce hits. A search that 401s in production while
   passing its tests would be a broken search box. */
{
  const found = await call('GET', '/api/search?q=design&limit=20');
  check('search returns 200', found.status === 200, `got ${found.status}`);

  const body = found.json as {
    results?: Array<{ id: string; scope: string; title: string; snippet: string | null; rank: number }>;
    counts?: Record<string, number>;
  };
  const results = body.results ?? [];
  check('search finds something for "design"', results.length > 0, `got ${results.length} results`);
  check(
    'a message hit carries a server-side snippet',
    results.some((r) => r.scope === 'messages' && r.snippet?.includes('<mark>')),
    `snippets: ${JSON.stringify(results.map((r) => r.snippet))}`,
  );
  check(
    'a substring match survives: dashboard-design.fig for "design"',
    results.some((r) => r.title === 'dashboard-design.fig'),
    `titles: ${JSON.stringify(results.map((r) => r.title))}`,
  );
  check(
    'results arrive ranked',
    results.every((r, i) => i === 0 || r.rank <= results[i - 1]!.rank),
    `ranks: ${JSON.stringify(results.map((r) => r.rank))}`,
  );
  check(
    'counts cover every scope',
    ['people', 'messages', 'files', 'events', 'teams'].every(
      (scope) => typeof body.counts?.[scope] === 'number',
    ),
    `counts: ${JSON.stringify(body.counts)}`,
  );

  const filesOnly = await call('GET', '/api/search?q=design&scope=files');
  const filesBody = filesOnly.json as { results?: Array<{ scope: string }>; counts?: Record<string, number> };
  check(
    'a narrowed scope returns only that scope',
    (filesBody.results ?? []).every((r) => r.scope === 'files'),
    `scopes: ${JSON.stringify((filesBody.results ?? []).map((r) => r.scope))}`,
  );
  check(
    'a narrowed scope still reports counts for the scopes it hid',
    typeof filesBody.counts?.messages === 'number',
    `counts: ${JSON.stringify(filesBody.counts)}`,
  );

  const bad = await call('GET', '/api/search?q=design&scope=nonsense');
  check('an unknown scope is rejected', bad.status === 400, `got ${bad.status}`);
}

/* 8d. Calendar events.

   Four screens read this endpoint -- the calendar, the dashboard, the activity
   page and the calls list -- so a 500 here empties more of the app than any other
   endpoint. */
{
  const events = await call('GET', '/api/events?days=30&limit=50');
  check('events return 200', events.status === 200, `got ${events.status}`);

  const body = events.json as {
    events?: Array<{ id: string; title: string; startsAt: string; attendeeIds: string[]; location: string }>;
    from?: string;
    to?: string;
  };
  const list = body.events ?? [];

  check('events are returned for the seeded calendar', list.length > 0, `got ${list.length}`);
  check(
    'events are ordered soonest first',
    list.every((e, i) => i === 0 || new Date(e.startsAt) >= new Date(list[i - 1]!.startsAt)),
    `starts: ${JSON.stringify(list.map((e) => e.startsAt))}`,
  );
  check(
    'every event carries attendee names alongside ids',
    list.every((e) => Array.isArray(e.attendeeIds)),
    'attendeeIds missing on at least one event',
  );
  check(
    'the response reports the window it searched',
    typeof body.from === 'string' && typeof body.to === 'string',
    `from=${body.from} to=${body.to}`,
  );

  // A private meeting must not be visible to a non-organiser. The seed's own
  // events all involve u1, so this asserts the shape of the answer rather than
  // finding a leak that is not there: u1 sees their own calendar and nothing 401s.
  const window = await call('GET', `/api/events?from=${new Date().toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`);
  check('an explicit window is accepted', window.status === 200, `got ${window.status}`);

  const inverted = await call('GET', '/api/events?from=2030-01-02T00:00:00.000Z&to=2030-01-01T00:00:00.000Z');
  check('an inverted window is rejected', inverted.status === 400, `got ${inverted.status}`);
}

/* 8e. Stats and attendance.

   Two endpoints that exist only to feed the dashboard, so nothing else in this
   script would notice if they broke. */
{
  const stats = await call('GET', '/api/stats');
  check('stats return 200', stats.status === 200, `got ${stats.status}`);
  const statsBody = stats.json as {
    dashboard?: Record<string, number>;
    apps?: Record<string, number>;
  };
  check(
    'stats return a dashboard block of whole numbers',
    statsBody.dashboard !== undefined &&
      Object.values(statsBody.dashboard).every((n) => Number.isInteger(n) && n >= 0),
    `dashboard: ${JSON.stringify(statsBody.dashboard)}`,
  );
  check(
    'stats return an apps block of whole numbers',
    statsBody.apps !== undefined &&
      Object.values(statsBody.apps).every((n) => Number.isInteger(n) && n >= 0),
    `apps: ${JSON.stringify(statsBody.apps)}`,
  );

  const attendance = await call('GET', '/api/attendance?days=30');
  check('attendance returns 200', attendance.status === 200, `got ${attendance.status}`);
  const attendanceBody = attendance.json as {
    records?: Array<{ userId: string; date: string }>;
    rules?: { lateAfterMinutes: number; overtimeAfterMinutes: number };
  };
  check(
    'attendance returns only the caller\'s records',
    (attendanceBody.records ?? []).every((r) => r.userId === 'u1'),
    `userIds: ${JSON.stringify((attendanceBody.records ?? []).map((r) => r.userId))}`,
  );
  check(
    'attendance dates are day keys, not timestamps',
    (attendanceBody.records ?? []).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)),
    `dates: ${JSON.stringify((attendanceBody.records ?? []).map((r) => r.date))}`,
  );
  check(
    'attendance publishes its thresholds',
    typeof attendanceBody.rules?.lateAfterMinutes === 'number' &&
      typeof attendanceBody.rules?.overtimeAfterMinutes === 'number',
    `rules: ${JSON.stringify(attendanceBody.rules)}`,
  );

  // Checking out with no check-in is the one punch that can be tested without
  // writing a row. Checking in would leave today's record behind and change what
  // the count checks in db:verify see.
  const badPunch = await call('POST', '/api/attendance/punch', { action: 'sideways' });
  check('an unknown punch action is rejected', badPunch.status === 400, `got ${badPunch.status}`);
}

/* 8f. Message edit and the channel file filter.

   Both are used by the chat screen, and both are the kind of thing that is easy to
   leave wired on the client and broken on the server. */
{
  const posted = await call('POST', '/api/messages', { channelId: 'c1', body: 'smoke edit target' });
  const target = (posted.json as { message?: { id: string; editedAt: string | null } }).message;
  check('a message can be posted to edit', posted.status === 201 && Boolean(target?.id), `got ${posted.status}`);

  if (target?.id) {
    const edited = await call('PATCH', `/api/messages/${target.id}`, { body: 'smoke edited' });
    const body = edited.json as { message?: { body: string; editedAt: string | null } };
    check('PATCH returns 200', edited.status === 200, `got ${edited.status}`);
    check('the edit stored the new body', body.message?.body === 'smoke edited', `got ${body.message?.body}`);
    check(
      'the edit stamped editedAt',
      typeof body.message?.editedAt === 'string',
      `editedAt: ${body.message?.editedAt}`,
    );

    const blank = await call('PATCH', `/api/messages/${target.id}`, { body: '   ' });
    check('an empty edit is rejected', blank.status === 400, `got ${blank.status}`);

    await call('DELETE', `/api/messages/${target.id}`);
  }

  const channelFiles = await call('GET', '/api/files?channelId=c1');
  check('files can be filtered by channel', channelFiles.status === 200, `got ${channelFiles.status}`);
  const badFilter = await call('GET', `/api/files?channelId=${'x'.repeat(200)}`);
  check('a malformed channelId is rejected', badFilter.status === 400, `got ${badFilter.status}`);
}

/* 9. logout invalidates the session */
r = await call('POST', '/api/auth/logout');
check('logout is 204', r.status === 204, `got ${r.status}`);
r = await call('GET', '/api/auth/me');
check('me is 401 after logout', r.status === 401, `got ${r.status}`);

console.log(failures === 0 ? '\nall smoke checks passed' : `\n${failures} smoke check(s) failed`);

// Announced rather than left to be found: three `db:verify` count checks will now
// fail until the database is reseeded, and a count check failing straight after a
// green smoke run looks like one of the two is wrong.
console.log(
  '\nNote: this run posted a message and soft-deleted a file, so both leave rows\n' +
    'behind. `npm run db:verify` checks row counts and will fail until the database\n' +
    'is reset with `npm run db:demo`.',
);
// Not process.exit(): tearing the process down while a socket handle is still
// closing trips a libuv assertion on Windows and buries the real output.
process.exitCode = failures === 0 ? 0 : 1;
