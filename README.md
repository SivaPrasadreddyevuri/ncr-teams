# NCR Teams — UI Prototype

A front-end-only prototype of a Teams-style collaboration workspace. It matches
the design in `ncr-teams/public/reference.png`: chat, meetings, files, calendar,
teams, attendance, HR and account screens, all backed by mock data.

## What this is

**There is no backend.** No database, no API, no authentication, no file
storage, no realtime connection.

- Every screen renders from the fixture module `lib/data.ts`.
- Interactions (sending a message, checking in, creating a team, joining a
  meeting) mutate local React state only.
- A page reload resets everything back to the seeded data.
- The sign-in screens are visual walkthroughs: any password is accepted and the
  two-factor code is the fixed `123456`.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` starts on port 3000. If that port is taken, use
`npm run dev -- -p 3003`.

```bash
npm run build     # production build
npm start         # serve the production build
npm run typecheck # tsc --noEmit
```

## Layout

| Path | Purpose |
| --- | --- |
| `lib/data.ts` | The whole mock dataset, plus its types |
| `lib/format.ts` | Date, size and initials helpers (client-safe, no dependencies) |
| `lib/nav.ts` | Route list, page titles, active-link matching |
| `app/(app)/` | The signed-in shell and its pages |
| `app/login`, `/activate`, `/forgot-password`, `/verify-2fa` | Mock auth walkthroughs |
| `components/` | UI pieces, one folder per feature |
| `app/globals.css` | The whole design system, no CSS framework |

## Routes

`/` · `/activity` · `/apps` · `/attendance` · `/calendar` · `/calls` ·
`/channels` · `/chat` · `/files` · `/hr` · `/meetings` · `/search` ·
`/settings` · `/teams`

## Adding a screen

1. Add the fixture to `lib/data.ts`.
2. Create `app/(app)/<route>/page.tsx` as a server component that reads the
   fixture and passes it to a client component.
3. Register the route in `lib/nav.ts` so it appears in the sidebar and topbar.
4. Reuse existing CSS classes — see the sections in `app/globals.css`.

## Next step

The intended next milestone is a real backend to replace `lib/data.ts`. Nothing
else in the app should need to change: pages already receive plain objects, and
the mutating handlers are isolated in the client components.
