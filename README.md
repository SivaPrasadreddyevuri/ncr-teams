# NCR Teams

![CI](https://github.com/SivaPrasadreddyevuri/ncr-teams/actions/workflows/ci.yml/badge.svg)
[![Live demo](https://img.shields.io/badge/live-demo-frontend--ashen--six--18.vercel.app-0070f0?style=flat-square)](https://frontend-ashen-six-18.vercel.app)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js 15](https://img.shields.io/badge/Next.js-15-000000)
![React 19](https://img.shields.io/badge/React-19-087ea4)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Tailwind 4](https://img.shields.io/badge/Tailwind-4-38bdf8)

A Microsoft Teams-style collaboration workspace — chat, channels, meetings,
files, calendar, attendance and HR.

The repository is split into three folders by concern: **`frontend/`** holds the
app that ships to the browser, **`backend/`** holds the API it will talk to, and
**[`database/`](./database)** holds the schema that API will use.

## Screenshots

| | |
| --- | --- |
| ![Chat](docs/screenshots/chat.png) <br/> **Chat** — channels, threads, reactions | ![Calendar](docs/screenshots/calendar.png) <br/> **Calendar** — week and month, 5 or 7 day |
| ![Files](docs/screenshots/files.png) <br/> **Files** — folders, starring, storage meter | ![Settings](docs/screenshots/settings.png) <br/> **Settings** — profile, notifications, appearance |

## Status

| Folder | State |
| --- | --- |
| `frontend/` | **Complete.** 19 routes, mock data, no backend. State lives in the browser. |
| `backend/` | **Specified only.** The API contract is written down; no code. |
| `database/` | **Specified only.** The schema is designed; no migrations. |

### Please read this before judging the backend

The frontend is deliberately self-contained. It reads from an in-memory fixture
module, so it runs with no services to install, no database, and no environment
variables to set. **Nothing is persisted** — every interaction mutates local
React state and resets on reload.

`backend/` and `database/` contain only a README each: a written API contract
(~40 endpoints) and a written schema (17 entities). They are specifications, not
implementations, and they are labelled as such. The point of the three-folder
layout is that when the backend is built, the swap is confined to the data layer
rather than rippling through the screens.

## Running it

```bash
npm install     # installs the workspace
npm run dev     # http://localhost:3000
```

If 3000 is taken:

```bash
npm run dev -- -p 3003
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`. They all
delegate to the `frontend` workspace.

## Layout

```
.
├── frontend/                  Next.js 15 App Router, React 19, TypeScript, Tailwind 4
│   ├── app/                   routing only — one folder per route
│   │   ├── (app)/             the signed-in shell: 14 routes, plus
│   │   │                      layout.tsx, loading.tsx, error.tsx
│   │   ├── login/             four auth walkthroughs sit at the app root,
│   │   ├── activate/          not in a route group — they share a component
│   │   ├── forgot-password/   (components/auth/AuthLayout.tsx) rather than
│   │   ├── verify-2fa/        a layout
│   │   ├── layout.tsx
│   │   └── globals.css        the whole design system, no CSS framework
│   ├── components/            UI, grouped by feature
│   ├── lib/                   data.ts (fixtures), format.ts, nav.ts
│   └── ...
│
├── backend/                   API service — scaffold only
│   └── README.md              endpoint contract, realtime protocol, stack
│
└── database/                  schema design — scaffold only
    └── README.md              entities, constraints, conventions, seed plan
```

This is an npm workspace: one `npm install` at the root covers every package.
`frontend/` is its own Next.js project because the App Router requires `app/` to
sit at a project root — it cannot be relocated to an arbitrary depth.

## The frontend

18 routes: 14 authenticated, plus 4 auth screens. No backend, no authentication,
no persistence.

| Route | What it does |
| --- | --- |
| `/` | Dashboard — live clock, next-event countdown, greeting, stat cards, today's meetings, activity |
| `/activity` | Combined activity feed and upcoming events |
| `/apps` | Launcher |
| `/attendance` | Check in/out with mutually exclusive buttons, history, team board |
| `/leave` | Submit a leave request with a reason and a from/to window, plus your own history |
| `/hr` | **HR only** — approval queue, departments, directory |
| `/calendar` | Day, week and month views, 5 or 7 day toggle, event CRUD |
| `/calls` | Call history and upcoming links |
| `/channels` | Channel directory grouped by team |
| `/chat` | Channels, threads, reactions, composer |
| `/files` | File table on wide screens, card list on phones, real uploads, folders, starring, storage meter |
| `/meetings` | Meeting list and the in-room experience |
| `/search` | Ranked search with scope filters and term highlighting |
| `/settings` | Profile photo upload, notifications, appearance, security |
| `/teams` | Team grid with create and join |
| `/login`, `/activate`, `/forgot-password`, `/verify-2fa` | Mock auth walkthroughs |

### Conventions worth knowing

- `lib/data.ts` is the single source of demo data. It exports typed fixtures
  plus its own types, so there is nothing to configure before running.
- `lib/format.ts` holds pure, dependency-free helpers. It is imported by client
  components, so it must never pull in a server-only package.
- `lib/nav.ts` is the route registry. Adding a route means adding one entry.
- `app/globals.css` carries the design tokens in a Tailwind `@theme` block.
  `:root` derives its variables from it, so the palette has one source of truth.
- `@/*` resolves to the `frontend/` root.

## Tech decisions

**The `@/*` alias is what made the monorepo move free.** It maps to `./*`
*relative to the tsconfig*, not to the repository root. When the app moved from
the repo root into `frontend/`, the tsconfig moved with it, so `@/lib/format`
kept resolving to `frontend/lib/format` and **not one import statement needed
rewriting**. Git recorded the move as renames with 100% similarity. It also
means `@/app/...` always means the frontend, never the backend.

**Scheduled times are pinned to `Asia/Kolkata` on both the server and the
client.** The first deployed build showed a 10:00 standup at **15:30** for anyone
not on UTC. `daysFromNow()` called `setHours()`, which interprets its argument in
*the process's* timezone — fine locally, wrong on Vercel, where functions run in
UTC. The server therefore emitted 10:00 and the browser re-rendered it as 15:30: a
hydration mismatch, not just a display shift. UTC was the first fix, but it is
wrong for the product: this is a workspace where a standup *is* at 10:00 IST
regardless of where the page is served from. `APP_TIME_ZONE` in `lib/format.ts`
is now the single source of truth, and every fixture and formatter resolves
against it.

Pinning a zone is only half of it. The offset itself has to be computed without
reference to the host timezone, or the same bug reappears on a developer machine
whose clock matches the app's. `appZoneOffsetMinutes()` reads the zone's wall
clock through `Intl.DateTimeFormat` and rebuilds it with `Date.UTC`; the obvious
alternative, `new Date(date.toLocaleString(...))`, looks equivalent and silently
returns a **zero** offset when the host is on IST. Verified against five host
timezones.

**The home clock is the deliberate exception: it shows the viewer's own local
time.** That value cannot be known on the server, and almost every route is
prerendered, so `HomeClock` renders a `--:--` placeholder until it mounts and
fills in afterwards. Reading `window.innerWidth` in a `useState` initialiser to
pick a layout would produce exactly the mismatch the zone pinning exists to
prevent, so the phone default is applied in an effect instead. The clock is
suppressed with `suppressHydrationWarning` and announced to screen readers on a
30-second cadence rather than every tick, which is unusable to listen to.

It carries a 12h/24h switch, because the viewer who cares that the schedule is
pinned to IST is often not in IST. One helper renders both so the two paths
cannot drift: `hours % 12 || 12` maps midnight 0 to 12 and leaves noon alone,
which `hours % 12` on its own would show as "0:30 PM". The meridiem is omitted in
24-hour mode, where it is redundant, and the choice persists under
`ncr-teams:clock-format` — a display preference that silently reset on every
reload would feel broken. The card shows no date at all: the greeting banner
above it already carries one.

**Attendance stores a `date`, not a timestamp.** The first build generated
`DD/MM/YYYY` strings, which `new Date()` cannot parse — every row rendered
"Invalid Date" *and* the status lookup silently failed, so the whole team showed
as not-checked-in. The fix was `YYYY-MM-DD` keys plus a `parseDayKey` helper that
builds a local date, since `new Date('2026-09-29')` is UTC midnight and renders
as the previous day west of Greenwich. The schema in `database/` carries the same
decision as a `date` column with a composite `(user_id, date)` primary key, which
also makes check-in idempotent for free.

**Most layout bugs had one root cause.** Interactive elements are `<button>`s, and
several class names set colour and typography but never reset the UA background
or border. The chat channel rows shrink-wrapped and painted grey boxes over each
other. A single reset fixed a whole class of problems, and it is why
`.conversation`, `.join` and `.file-link` all carry explicit `background: none`
and `width: 100%` rather than inheriting anything.

**Search ranks by match quality, then recency.** `exact > prefix >
word-boundary > substring`, so a search for "design" puts the "design" channel
above a file called `redesign-notes.md`. Scores are computed per field, so a hit
in a job title can outrank a hit in a long message body.

## Where this is going

The intended next milestone is a real backend, in this order:

1. `database/` — migrations and seed matching the documented entities.
2. `backend/` — the endpoints in `backend/README.md`, replacing `lib/data.ts`.
3. Auth and row-level security, so the mock sign-in screens become real.
4. WebSocket delivery for messages and presence.
5. File upload to object storage.

Nothing above requires a structural change. Pages already receive plain objects,
and the mutating handlers are isolated in client components, so the data layer
can be swapped without touching layout or design.

## The profile photo

Settings > Profile accepts an image from the local device, by picker or by
dropping it on the avatar. It is the one place in the app that writes to
`localStorage`, which introduced two problems worth naming.

**Storage is read in an effect, never during render.** Nearly every route is
prerendered, so the server has no way to know what is in storage. Reading it in a
`useState` initialiser would make the first client paint disagree with the server
HTML — a hydration mismatch. The provider renders `currentUser` and applies the
stored profile afterwards, so the markup matches first and then updates.

**The image is re-encoded, not stored as-is.** `lib/image.ts` decodes with
`createImageBitmap`, falls back to an `Image` element for sources the bitmap
decoder rejects, and redraws to a 256px WebP. A phone photo is 3–8MB and
`localStorage` caps around 5MB, so the original would throw
`QuotaExceededError` on the first upload; the re-encoded result is ~15KB, which
is also far more detail than a 44px avatar can show.

**"All image formats" is not fully achievable and the UI says so.** Browsers
decode JPEG, PNG, GIF, WebP, AVIF, BMP, SVG and ICO. They do **not** decode
**HEIC/HEIF** — an iPhone's default, which Chrome and Windows will not display —
nor TIFF. `accept="image/*"` lets the OS picker offer everything it can, and an
undecodable file gets an explicit message telling the user to export as JPEG or
PNG. Covering HEIC properly needs a decoder of several hundred KB, which is a bad
trade for a prototype.

**One indirection makes it reach everywhere.** `PersonAvatar` reads the profile
store and renders a photo for the signed-in user, falling through to initials for
everyone else. It is a *client* component, so a server component can render it,
which is how the photo reaches the HR and Calls lists without those pages
becoming client components. The asymmetry to be aware of: those two lists still
show the **static name**, because a server component cannot read storage. Name
edits propagate to the sidebar, topbar, chat, meeting room, attendance and leave
tables, but not to the server-rendered lists.

The photo also replaces the online dot, and the image is clipped by its own
`border-radius` rather than by `overflow: hidden` on `.avatar` — the dot is
positioned at `right/bottom: -1px` so it deliberately overhangs, and an overflow
rule would slice it in half.

## Signing in, and what a role can see

There is no authentication, so the sign-in screen offers a **persona picker**:
an employee, two managers and the HR administrator. Choosing one is what
decides the session, and the choice persists across reloads.

This exists because the app cannot demonstrate a second role otherwise. The
signed-in person used to be hardcoded to `currentUser` inside a *server*
layout, so every visitor was the same person and every role-based screen was
unreachable in the state it was designed for.

Two mechanisms, deliberately separate:

- **Nav filtering.** `NavItem.roles` hides `/hr` from anyone who is not an
  `HR_ADMIN`, along with the dashboard's *Pending requests* stat and the
  leave entries in the activity feed.
- **A route guard.** `RoleGate` wraps the HR page, because a missing nav entry
  stops nobody. Typing `/hr` as an employee shows an access-denied panel
  linking somewhere useful.

**The guard is not security.** `/hr` is prerendered, so its markup is in the
public HTML and view-source will show it; the guard only stops the UI from
rendering. It does at least render a neutral placeholder until the role
resolves, so HR content does not flash at an employee during hydration. Real
enforcement means checking the role on the server, which is what the backend
milestone would add.

## The workspace store

`WorkspaceProvider` owns everything that has to outlive a component: the
active persona, leave requests, attendance records and file metadata. It
seeds from `lib/data.ts` and restores from `localStorage` after mount.

Before it existed those were each a local `useState`, which made three
workflows *impossible* rather than merely unsaved. An employee could not
submit a leave request that HR would then see, because they were two people on
two routes holding two copies of the same array — there was no shared value to
approve. Attendance said so on screen: "Kept in this session only". And the
signed-in person was fixed in a server layout.

`ProfileProvider` sits inside it and stores a **map keyed by person id**, so
one persona's edited name and uploaded photo cannot leak onto another's.

Every restore follows the same rule: render the fixture seed so the server HTML
and the first client paint agree, then read storage in an effect. Reading during
render would be a hydration mismatch, and nearly every route here is
prerendered. Writes are gated on the restore having happened, or the seed would
clobber what was stored.

File *contents* are the exception and live in IndexedDB — see below.

**Uploads store real bytes in IndexedDB.** The Upload button used to be
disabled with the tooltip "Uploads need a backend". It does not need one to be
honest about itself: the browser will store a blob. Contents go to IndexedDB and
metadata to the workspace store, because `localStorage` caps near 5MB *total* and
base64 inflates bytes by a third — a handful of real documents would exhaust it,
and the failure mode is an exception on write rather than a gradual decline.

The input carries **no `accept` filter**. Unlike images, an arbitrary file needs
no decoding, so type genuinely is not a limit here; only size is. The nine
seeded fixture rows have no bytes behind them, so clicking one says so rather
than doing nothing, and deleting a row drops its blob so orphans cannot quietly
consume the quota.

**`STORAGE_QUOTA_BYTES = 50GB` is gone.** It was a hardcoded constant, and the
moment real bytes landed, a meter claiming 50GB of headroom would have been
lying about a limit the browser was already enforcing. The meter now reports
`navigator.storage.estimate()`, exposes itself as a `progressbar`, and says what
it can when no estimate is available instead of inventing a quota.

**Leave windows are read in `APP_TIME_ZONE`, not the visitor's local zone.**
`fromAppInputValue` resolves "09:00" the way a calendar event resolves it, so a
request round-trips to the time that was typed. `new Date(value)` would have
reinterpreted it in the browser's zone and shifted every request by the
difference — the same class of bug as the original fixture timezone defect.

**Attendance's two buttons come from one derived phase** (`OUT`, `IN`, `DONE`)
rather than two `disabled` expressions, which could drift out of agreement.
Checking in sets only `checkIn`; checking out sets only `checkOut`, and both
update the existing record rather than deleting and recreating it. Status
(`LATE` past 09:30) and overtime are derived from the timestamps so neither can
contradict them.

## Loading skeletons — and what they are honestly for

Every route here is prerendered, so **nothing is ever slow and Next's own
`loading.tsx` never fires.** The skeleton components were already written and
reachable only through Suspense, which for a static route never suspends — so
they were complete, well-styled, and invisible.

`RouteGate` makes them visible. It is a client component inside the app layout,
so the sidebar and topbar paint immediately and only the page body is replaced.
Three decisions in it are deliberate rather than obvious:

- **A hard load shows no skeleton at all.** The first effect run is skipped, so a
  refresh paints real content immediately. Holding first paint for the full
  skeleton delay would make the app look slower than it is, and the first
  impression is the part worth protecting. The distinction leans on
  `usePathname` changing: a navigation re-renders the gate, a hard load only ever
  mounts it once.
- **The real markup stays in the DOM**, `hidden` rather than unmounted. It is
  still in the static HTML for crawlers and the reveal needs nothing fetched.
- **Reduced motion gets a fifth of that wait — 200ms against 1s.** The shimmer is
  already disabled for those users, so a full-length wait would be a full-length
  *static* grey page. The ratio is expressed as `LOADING_MS / 5` rather than a
  literal, because at 600ms against a 1s wait it was 60% of the delay and had
  all but cancelled the point of the branch.

Each skeleton mirrors its own screen — the same grid classes, the same column
count, the same row shapes — and that includes the responsive behaviour. The
calendar shows one day column on a phone because the live page drops to its day
view there, and the files skeleton swaps its table for a card list below 640px
for the same reason. This was not free: the first version rendered desktop shapes
everywhere and overflowed a 320px viewport on three routes.

**These are a presentation of a loading state, not a performance feature.** The
app does not need them, because there is nothing to wait for. They exist to
demonstrate the design, and no route bundles less because of them — `RouteGate` is
a few hundred bytes on a ~105 kB first load, and code splitting was already
handled by the router.

## Responsiveness, and how it was checked

Every route was verified at 17 widths from 320px to 1600px against a real
production build in headless Chrome. Three things about that are worth recording,
because all three produced confident false results first.

**Screenshots alone are not a test, and neither is a document-level check.**
`document.scrollWidth` reported every page clean while the files list was in fact
unusable on a phone: the real defect was a 560px `min-width` on a table that
scrolled *inside* its own container, which never touches the document. The check
that matters is whether content **escapes the viewport** — measure
`getBoundingClientRect().right` against `documentElement.clientWidth` for every
element, not scroll widths.

**A passing sweep can be measuring an empty page.** An early run reported 78
routes clean while the app was throwing `ChunkLoadError` and rendering nothing,
because `next start` was running from before a rebuild and serving stale chunk
hashes. An empty body has no overflow. The sweep now asserts a known element
exists on every route, and fails on React hydration warnings, which is the only
channel those surface through. The fix when it happens is to stop the old
server, delete `.next`, and rebuild — a running server caches the build manifest
in memory.

**A failing assertion is not automatically an app bug.** Two were bad tests: one
asserted a zero-padded `09:00` while `en-GB` correctly renders `9:00` for
`hour: 'numeric'`, and another hardcoded 41 bytes for a JSON fixture that is 37.
The first was worth chasing, because relaxing it revealed midnight rendering as
`0:00`. The second was not, and now compares against the bytes on disk. When one
fails, work out which it is before changing the app.

**`--window-size` does not work on Windows.** `chrome --headless --window-size`
clamps and crops, so a 375px run silently measured something wider. The numbers
above come from CDP `Emulation.setDeviceMetricsOverride`, which sets the layout
viewport directly.

Three CSS rules account for most of what was fixed, and all three are easy to get
wrong in a way that *looks* right:

- `min-width: 0` on grid children. Grid items default to `min-width: auto` and
  refuse to shrink below their content, so one wide table widened the whole track
  and made the document scroll sideways — 9px on `/calls`, 15px on `/hr`, only
  visible at 320px.
- A table becomes a card list below 640px, and the calendar becomes a one-day
  column below 760px, rather than either being allowed to pan sideways. A phone
  cannot show five day columns, and a settings rail that scrolls horizontally
  hides most of its own tabs.
- The card list's `display: block` override is qualified as `ul.file-cards`. The
  base `.file-cards { display: none }` is declared *later* in the file, and at
  equal specificity the later rule wins — the cards were in the DOM the whole
  time and simply not displayed.

## Licence

MIT — see [LICENSE](./LICENSE).
