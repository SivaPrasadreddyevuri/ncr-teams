import { Skeleton, SkeletonPage } from '@/components/Skeleton';

export default function Loading() {
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
