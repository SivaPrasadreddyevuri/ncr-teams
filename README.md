# NCR Teams

A Microsoft Teams-style collaboration workspace — chat, channels, meetings,
files, calendar, attendance and HR.

The repository is split into three folders by concern: **`frontend/`** holds the
app that ships to the browser, **`backend/`** holds the API it will talk to, and
**[`database/`](./database)** holds the schema that API will use.

## Status

| Folder | State |
| --- | --- |
| `frontend/` | **Complete and running.** 22 routes, mock data, no backend. |
| `backend/` | **Specified only.** The API contract is written down; no code. |
| `database/` | **Specified only.** The schema is designed; no migrations. |

The frontend is deliberately self-contained today. It reads from an in-memory
fixture module, so it runs with no services to install and nothing to configure.
The point of this layout is that when the backend arrives, the swap is confined
to the data layer rather than rippling through the screens.

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
│   │   ├── (app)/             the signed-in shell, 17 routes
│   │   ├── (auth)/            login, activation, reset, two-factor
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

Seventeen authenticated routes plus four auth screens. No backend, no
authentication, no persistence: every interaction mutates local React state and
resets on reload.

| Route | What it does |
| --- | --- |
| `/` | Dashboard — greeting, stat cards, today's meetings, activity |
| `/activity` | Combined activity feed and upcoming events |
| `/apps` | Launcher |
| `/attendance` | Check in/out, personal history, team board |
| `/calendar` | Week and month views, 5 or 7 day toggle, event CRUD |
| `/calls` | Call history and upcoming links |
| `/channels` | Channel directory grouped by team |
| `/chat` | Channels, threads, reactions, composer |
| `/files` | File table, folders, starring, storage meter |
| `/hr` | Leave approvals, departments, directory |
| `/meetings` | Meeting list and the in-room experience |
| `/search` | Ranked search with scope filters and term highlighting |
| `/settings` | Profile, notifications, appearance, security |
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
