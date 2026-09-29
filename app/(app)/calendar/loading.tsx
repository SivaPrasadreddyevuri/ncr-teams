import { Skeleton, SkeletonPage } from '@/components/Skeleton';

export default function Loading() {
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

        <div className="calendar-week">
          <div className="calendar-hours">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} style={{ height: 10, width: 30, marginBottom: 54 }} />
            ))}
          </div>

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
