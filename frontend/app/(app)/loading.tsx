import { Skeleton, SkeletonPage, SkeletonText } from '@/components/Skeleton';

/**
 * Default loading state for every authenticated route.
 *
 * Because the shell lives in `app/(app)/layout.tsx`, this renders *inside* the
 * sidebar and topbar: navigation paints immediately and only the page body is
 * replaced, instead of the whole viewport flashing.
 *
 * Routes whose layout is distinctive enough to be worth matching ship their own
 * `loading.tsx` (chat, calendar, files, teams).
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading page">
      <div className="skeleton-welcome">
        <div>
          <Skeleton style={{ height: 26, width: 260 }} />
          <Skeleton style={{ height: 14, width: 340, marginTop: 12 }} />
        </div>
        <Skeleton style={{ height: 40, width: 180 }} />
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
