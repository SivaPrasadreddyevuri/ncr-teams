import { Skeleton, SkeletonPage, SkeletonTable, SkeletonText } from '@/components/Skeleton';

/**
 * Per-route page skeletons.
 *
 * Each one mirrors the *real* layout of the route it stands in for -- the same
 * grid classes, the same number of columns, the same row shapes -- so the
 * transition to content does not move anything. A generic stack of grey bars
 * would be cheaper to write and would be worth less: the point of a structural
 * skeleton is that the page does not reflow when it arrives.
 *
 * These live here rather than in each route's `loading.tsx` so the same
 * component serves two callers: Next's Suspense fallback, and the
 * `RouteGate` that shows a skeleton on client-side navigation. One definition,
 * one place to change a shape.
 */

/* ------------------------------------------------------------------ */
/* Moved from app/(app)/<route>/loading.tsx, unchanged                 */
/* ------------------------------------------------------------------ */

export function ChatSkeleton() {
  return (
    <SkeletonPage label="Loading chat">
      <div className="page-grid">
        {/* conversation list */}
        <div className="panel">
          <div className="panel-head">
            <Skeleton style={{ height: 14, width: 60 }} />
          </div>
          <div className="list">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="conversation" key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                  <Skeleton style={{ height: 11, width: '62%' }} />
                  <Skeleton style={{ height: 10, width: '88%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* thread */}
        <div className="panel chat-panel">
          <div className="panel-head">
            <Skeleton circle style={{ width: 30, height: 30 }} />
            <Skeleton style={{ height: 13, width: 150 }} />
          </div>
          <div className="chat-body">
            {[46, 62, 38, 70, 44].map((width, index) => (
              <div className={index % 2 ? 'msg mine' : 'msg'} key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <Skeleton
                  style={{ height: 42, width: `${width}%`, maxWidth: 300, borderRadius: 14 }}
                />
              </div>
            ))}
          </div>
          <div className="composer">
            <Skeleton style={{ height: 38, flex: 1, borderRadius: 10 }} />
            <Skeleton style={{ height: 38, width: 38, borderRadius: 9 }} />
          </div>
        </div>

        {/* members */}
        <div className="panel">
          <div className="panel-head">
            <Skeleton style={{ height: 14, width: 110 }} />
          </div>
          <div className="members">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="member" key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 11, width: '58%' }} />
                  <Skeleton style={{ height: 9, width: '38%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

export function CalendarSkeleton() {
  return (
    <SkeletonPage label="Loading calendar">
      <div className="calendar">
        <div className="calendar-toolbar">
          <div>
            <Skeleton style={{ height: 16, width: 160 }} />
            <Skeleton style={{ height: 12, width: 200, marginTop: 10 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton style={{ height: 38, width: 38, borderRadius: 10 }} />
            <Skeleton style={{ height: 38, width: 38, borderRadius: 10 }} />
            <Skeleton style={{ height: 38, width: 110, borderRadius: 8 }} />
          </div>
        </div>

        <div className="calendar-week sk-calendar-week">
          <div className="calendar-hours">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} style={{ height: 10, width: 30, marginBottom: 54 }} />
            ))}
          </div>

          {/* Five columns on desktop, one on a phone -- the same switch the real
              calendar makes, since it drops to its day view below 760px. The
              extra four are hidden by CSS rather than not rendered, so the
              breakpoint logic lives in one stylesheet alongside the live rule. */}
          {Array.from({ length: 5 }, (_, dayIndex) => (
            <div className="calendar-day" key={dayIndex}>
              <div className="calendar-day-head">
                <Skeleton style={{ height: 12, width: 74 }} />
              </div>
              <div className="calendar-day-body">
                {Array.from({ length: 10 }, (_, index) => (
                  <div className="calendar-slot" key={index} />
                ))}
                {/* A couple of placeholder events so the grid does not read as empty. */}
                {dayIndex % 2 === 0 && (
                  <div
                    className="skeleton-event"
                    style={{ top: 128 + dayIndex * 20, left: 4, right: 4, height: 52 }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

export function FilesSkeleton() {
  return (
    <SkeletonPage label="Loading files">
      <div className="section-card">
        <div className="section-head">
          <div style={{ minWidth: 0 }}>
            <Skeleton style={{ height: 15, width: 90 }} />
            <Skeleton style={{ height: 12, width: '60%', maxWidth: 240, marginTop: 9 }} />
          </div>
          {/* The live toolbar is a search box plus three controls, and it wraps
              below 640px. Two fixed 200/100px bars did not: 310px plus a gap
              overflowed a 375px screen by 70px. The wide bar is capped and
              shrinks; both collapse entirely on a phone, as the real one does. */}
          <div className="sk-files-toolbar">
            <Skeleton style={{ height: 36, width: 200, maxWidth: '100%', flex: '1 1 120px', borderRadius: 11 }} />
            <Skeleton style={{ height: 36, width: 100, flex: '0 1 90px', borderRadius: 8 }} />
          </div>
        </div>

        {/* Wide screens get the table; phones get the card list, matching the live
            page's own 640px switch. Rendering only the table overflowed by
            275px at 320px, and it was also unfaithful -- the real page shows
            cards there. CSS decides which is visible. */}
        <div className="sk-files-table">
          <SkeletonTable rows={7} columns={5} />
        </div>

        <ul className="file-cards sk-files-cards">
          {Array.from({ length: 6 }, (_, index) => (
            <li className="file-card" key={index}>
              <div className="file-card-head">
                <Skeleton style={{ height: 30, width: 30, borderRadius: 9, flex: 'none' }} />
                <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
                  <Skeleton style={{ height: 13, width: '64%' }} />
                </div>
                <Skeleton style={{ height: 26, width: 26, borderRadius: 8, flex: 'none' }} />
              </div>
              <div className="file-card-meta">
                {Array.from({ length: 3 }, (_, column) => (
                  <div key={column}>
                    <Skeleton style={{ height: 9, width: 44 }} />
                    <Skeleton style={{ height: 12, width: '72%', marginTop: 6 }} />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div className="storage-meter">
          <Skeleton style={{ height: 11, width: 200 }} />
          <Skeleton style={{ height: 6, width: '100%', borderRadius: 6, marginTop: 10 }} />
        </div>
      </div>
    </SkeletonPage>
  );
}

export function TeamsSkeleton() {
  return (
    <SkeletonPage label="Loading teams">
      <div className="section-card">
        <div className="section-head">
          <div>
            <Skeleton style={{ height: 15, width: 80 }} />
            <Skeleton style={{ height: 12, width: 220, marginTop: 9 }} />
          </div>
          <Skeleton style={{ height: 34, width: 130, borderRadius: 8 }} />
        </div>

        <div className="cards-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="team-card" key={index}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Skeleton style={{ height: 42, width: 42, borderRadius: 12 }} />
                <Skeleton circle style={{ height: 16, width: 16 }} />
              </div>
              <Skeleton style={{ height: 14, width: '62%', marginTop: 16 }} />
              <Skeleton style={{ height: 12, width: '88%', marginTop: 10 }} />
              <Skeleton style={{ height: 12, width: '42%', marginTop: 16 }} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

/* ------------------------------------------------------------------ */
/* New skeletons, shaped from the route they stand in for              */
/* ------------------------------------------------------------------ */

export function HomeSkeleton() {
  return (
    <SkeletonPage label="Loading dashboard">
      {/* welcome band, then the clock strip, then four stat cards.
          The bar widths are percentages with a max, not fixed pixels: a
          hardcoded 340px overflowed a 375px screen by 8px, which the old default
          loading.tsx also did -- it just never rendered, so nobody saw it. */}
      <div className="skeleton-welcome">
        <div style={{ minWidth: 0 }}>
          <Skeleton style={{ height: 26, width: '58%', maxWidth: 260 }} />
          <Skeleton style={{ height: 14, width: '88%', maxWidth: 340, marginTop: 12 }} />
        </div>
        <Skeleton style={{ height: 40, width: 160, flex: 'none' }} />
      </div>

      {/* The clock strip. The middle column is `flex: 1; min-width: 0` with a
          percentage-wide bar: fixed widths here overflowed a 320px screen by
          63px, because 40 + 13 + 190 + 74 + padding exceeds what is available. */}
      <div className="sk-home-clock">
        <Skeleton style={{ height: 40, width: 40, borderRadius: 11, flex: 'none' }} />
        <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
          <Skeleton style={{ height: 24, width: 128 }} />
          <Skeleton style={{ height: 12, width: '100%' }} />
        </div>
        <Skeleton style={{ height: 34, width: 74, borderRadius: 8, flex: 'none' }} />
      </div>

      <div className="stats">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="skeleton-stat" />
        ))}
      </div>

      <div className="grid-2">
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 150 }} />
          <SkeletonText lines={5} className="skeleton-rows" />
        </div>
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 130 }} />
          <SkeletonText lines={5} className="skeleton-rows" />
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Attendance: status facts, history rows, team roster, legend. */
export function AttendanceSkeleton() {
  return (
    <SkeletonPage label="Loading attendance">
      <div className="grid-2">
        <div className="section-card">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="profile-facts" key={index} style={{ marginBottom: 14 }}>
              <Skeleton style={{ height: 12, width: 70 }} />
              <Skeleton style={{ height: 14, width: 84 }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton style={{ height: 38, width: 104, borderRadius: 9 }} />
            <Skeleton style={{ height: 38, width: 110, borderRadius: 9 }} />
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 90 }} />
          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                <Skeleton style={{ height: 12, width: 62 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 12, width: '42%' }} />
                  <Skeleton style={{ height: 10, width: '30%' }} />
                </div>
                <Skeleton style={{ height: 20, width: 44, borderRadius: 10 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 110 }} />
          <div className="members" style={{ marginTop: 10 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="member" key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 11, width: '56%' }} />
                  <Skeleton style={{ height: 9, width: '36%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 60 }} />
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            {Array.from({ length: 4 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                <Skeleton style={{ height: 30, width: 30, borderRadius: 9 }} />
                <div style={{ display: 'grid', gap: 5, flex: 1 }}>
                  <Skeleton style={{ height: 11, width: '44%' }} />
                  <Skeleton style={{ height: 9, width: '26%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Leave: the submit form's real field set beside the request history. */
export function LeaveSkeleton() {
  return (
    <SkeletonPage label="Loading leave">
      <div className="grid-2">
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 110 }} />
          <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
            <div className="form-field">
              <Skeleton style={{ height: 12, width: 96 }} />
              <Skeleton style={{ height: 40, width: '100%', borderRadius: 10, marginTop: 7 }} />
            </div>

            {/* the two datetime fields, side by side exactly as the form is */}
            <div className="leave-window">
              <div className="form-field">
                <Skeleton style={{ height: 12, width: 34 }} />
                <Skeleton style={{ height: 40, width: '100%', borderRadius: 10, marginTop: 7 }} />
              </div>
              <div className="form-field">
                <Skeleton style={{ height: 12, width: 26 }} />
                <Skeleton style={{ height: 40, width: '100%', borderRadius: 10, marginTop: 7 }} />
              </div>
            </div>

            <div className="form-field">
              <Skeleton style={{ height: 12, width: 54 }} />
              <Skeleton style={{ height: 78, width: '100%', borderRadius: 10, marginTop: 7 }} />
            </div>

            <Skeleton style={{ height: 38, width: 150, borderRadius: 9 }} />
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 100 }} />
          <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
            {Array.from({ length: 3 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }} key={index}>
                <Skeleton style={{ height: 30, width: 30, borderRadius: 9 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 12, width: '52%' }} />
                  <Skeleton style={{ height: 10, width: '78%' }} />
                  <Skeleton style={{ height: 10, width: '40%' }} />
                </div>
                <Skeleton style={{ height: 20, width: 74, borderRadius: 10 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

/** HR: approval queue with its decision buttons, beside the status summary. */
export function HrSkeleton() {
  return (
    <SkeletonPage label="Loading HR">
      <div className="grid-2">
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 130 }} />
          <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
            {Array.from({ length: 4 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }} key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <div style={{ display: 'grid', gap: 5, flex: 1 }}>
                  <Skeleton style={{ height: 12, width: '48%' }} />
                  <Skeleton style={{ height: 10, width: '72%' }} />
                  <Skeleton style={{ height: 10, width: '38%' }} />
                </div>
                <Skeleton style={{ height: 20, width: 58, borderRadius: 10 }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <Skeleton style={{ height: 28, width: 28, borderRadius: 8 }} />
                  <Skeleton style={{ height: 28, width: 28, borderRadius: 8 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 70 }} />
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            {Array.from({ length: 3 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                <Skeleton style={{ height: 30, width: 30, borderRadius: 9 }} />
                <div style={{ display: 'grid', gap: 5, flex: 1 }}>
                  <Skeleton style={{ height: 11, width: '42%' }} />
                  <Skeleton style={{ height: 9, width: '28%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 100 }} />
          <SkeletonText lines={5} className="skeleton-rows" />
        </div>
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 80 }} />
          <div className="members" style={{ marginTop: 10 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="member" key={index}>
                <Skeleton circle style={{ width: 30, height: 30 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 11, width: '52%' }} />
                  <Skeleton style={{ height: 9, width: '68%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Settings: the identity block, then the field list, then the save row. */
export function SettingsSkeleton() {
  return (
    <SkeletonPage label="Loading settings">
      <div className="settings">
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              key={index}
              style={{ height: 38, width: '100%', borderRadius: 11 }}
            />
          ))}
        </div>

        <div className="panel settings-panel">
          <div className="avatar-picker">
            <div className="avatar-picker-drop">
              <Skeleton circle style={{ width: 44, height: 44 }} />
              <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                <Skeleton style={{ height: 14, width: 110 }} />
                <Skeleton style={{ height: 11, width: '72%' }} />
              </div>
            </div>
          </div>

          <div className="settings-body">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="form-field" key={index}>
                <Skeleton style={{ height: 12, width: 88 }} />
                <Skeleton
                  style={{ height: index === 5 ? 78 : 40, width: '100%', borderRadius: 10, marginTop: 7 }}
                />
              </div>
            ))}
            <Skeleton style={{ height: 38, width: 140, borderRadius: 9 }} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Search: the query bar, the scope chips, then result rows. */
export function SearchSkeleton() {
  return (
    <SkeletonPage label="Loading search">
      <div className="search-page">
        <div className="search-page-bar">
          <Skeleton circle style={{ width: 19, height: 19 }} />
          <Skeleton style={{ height: 16, width: '46%' }} />
        </div>

        <div className="scope-chips">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} style={{ height: 30, width: 104, borderRadius: 15 }} />
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}
            >
              <Skeleton style={{ height: 34, width: 34, borderRadius: 10 }} />
              <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                <Skeleton style={{ height: 12, width: `${52 + (index % 3) * 12}%` }} />
                <Skeleton style={{ height: 10, width: '34%' }} />
              </div>
              <Skeleton style={{ height: 10, width: 48 }} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Activity: the feed, the coming-up list, and the quick-jump cards. */
export function ActivitySkeleton() {
  return (
    <SkeletonPage label="Loading activity">
      <div className="grid-2">
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 130 }} />
          <div style={{ display: 'grid', gap: 15, marginTop: 14 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }} key={index}>
                <Skeleton style={{ height: 32, width: 32, borderRadius: 10 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 12, width: `${54 + (index % 3) * 10}%` }} />
                  <Skeleton style={{ height: 10, width: '72%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <Skeleton style={{ height: 15, width: 100 }} />
          <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                <Skeleton style={{ height: 12, width: 58 }} />
                <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                  <Skeleton style={{ height: 12, width: '46%' }} />
                  <Skeleton style={{ height: 10, width: '64%' }} />
                </div>
                <Skeleton style={{ height: 30, width: 62, borderRadius: 8 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="cards-grid cards-grid--quick">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="team-card" key={index}>
              <div className="team-icon">
                <Skeleton style={{ height: 22, width: 22 }} />
              </div>
              <Skeleton style={{ height: 13, width: '58%', marginTop: 12 }} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

/** Calls: history with status chips beside upcoming links. */
export function CallsSkeleton() {
  return (
    <SkeletonPage label="Loading calls">
      <div className="grid-2">
        {['Call history', 'Upcoming'].map((title, card) => (
          <div className="section-card" key={title}>
            <Skeleton style={{ height: 15, width: 120 }} />
            <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
              {Array.from({ length: 4 }, (_, index) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                  {card === 0 ? (
                    <Skeleton circle style={{ width: 30, height: 30 }} />
                  ) : (
                    <Skeleton style={{ height: 12, width: 58 }} />
                  )}
                  <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                    <Skeleton style={{ height: 12, width: `${48 + (index % 3) * 8}%` }} />
                    <Skeleton style={{ height: 10, width: '62%' }} />
                  </div>
                  <Skeleton style={{ height: 20, width: 62, borderRadius: 10 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/** Channels: a card per team, each listing its channels. */
export function ChannelsSkeleton() {
  return (
    <SkeletonPage label="Loading channels">
      <div className="grid-2">
        {Array.from({ length: 4 }, (_, team) => (
          <div className="section-card" key={team}>
            <div className="section-head">
              <Skeleton style={{ height: 15, width: 110 }} />
              <Skeleton style={{ height: 12, width: 70 }} />
            </div>
            <div style={{ display: 'grid', gap: 15, marginTop: 6 }}>
              {Array.from({ length: 3 }, (_, index) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                  <Skeleton style={{ height: 16, width: 16 }} />
                  <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                    <Skeleton style={{ height: 12, width: '40%' }} />
                    <Skeleton style={{ height: 10, width: '74%' }} />
                  </div>
                  <Skeleton style={{ height: 10, width: 44 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/** Apps: the launcher card grid. */
export function AppsSkeleton() {
  return (
    <SkeletonPage label="Loading apps">
      <div className="cards-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="team-card" key={index}>
            <div className="team-icon">
              <Skeleton style={{ height: 22, width: 22 }} />
            </div>
            <Skeleton style={{ height: 14, width: '54%', marginTop: 14 }} />
            <Skeleton style={{ height: 11, width: '82%', marginTop: 9 }} />
            <div className="members-line" style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
              <Skeleton style={{ height: 20, width: 38, borderRadius: 10 }} />
              <Skeleton style={{ height: 15, width: 15, marginLeft: 'auto' }} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/** Meetings: the meeting list beside the room list. */
export function MeetingsSkeleton() {
  return (
    <SkeletonPage label="Loading meetings">
      <div className="grid-2">
        {['Meetings', 'Meeting rooms'].map((title) => (
          <div className="section-card" key={title}>
            <Skeleton style={{ height: 15, width: 120 }} />
            <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
              {Array.from({ length: 4 }, (_, index) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} key={index}>
                  <Skeleton style={{ height: 12, width: 54 }} />
                  <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                    <Skeleton style={{ height: 12, width: `${52 + (index % 3) * 8}%` }} />
                    <Skeleton style={{ height: 10, width: '66%' }} />
                  </div>
                  <Skeleton style={{ height: 30, width: 66, borderRadius: 8 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/** Fallback for a path with no skeleton of its own. */
export function GenericSkeleton() {
  return (
    <SkeletonPage label="Loading page">
      <div className="grid-2">
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 150 }} />
          <SkeletonText lines={5} className="skeleton-rows" />
        </div>
        <div className="section-card">
          <Skeleton style={{ height: 15, width: 130 }} />
          <SkeletonText lines={5} className="skeleton-rows" />
        </div>
      </div>
    </SkeletonPage>
  );
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Skeleton for a pathname, matched on the longest known route so a future
 * `/files/shared` style path still resolves to the files skeleton rather than
 * falling through to the generic one.
 */
const BY_ROUTE: Array<[string, () => React.JSX.Element]> = [
  ['/activity', ActivitySkeleton],
  ['/apps', AppsSkeleton],
  ['/attendance', AttendanceSkeleton],
  ['/calendar', CalendarSkeleton],
  ['/calls', CallsSkeleton],
  ['/channels', ChannelsSkeleton],
  ['/chat', ChatSkeleton],
  ['/files', FilesSkeleton],
  ['/hr', HrSkeleton],
  ['/leave', LeaveSkeleton],
  ['/meetings', MeetingsSkeleton],
  ['/search', SearchSkeleton],
  ['/settings', SettingsSkeleton],
  ['/teams', TeamsSkeleton],
];

export function skeletonFor(pathname: string): () => React.JSX.Element {
  const match = BY_ROUTE.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
  // The dashboard is the root, so it has to be checked last or it would match
  // every path as a prefix.
  if (pathname === '/') return HomeSkeleton;
  return (match?.[1] ?? GenericSkeleton);
}
