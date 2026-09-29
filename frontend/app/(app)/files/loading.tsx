import { Skeleton, SkeletonPage, SkeletonTable } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonPage label="Loading files">
      <div className="section-card">
        <div className="section-head">
          <div>
            <Skeleton style={{ height: 15, width: 90 }} />
            <Skeleton style={{ height: 12, width: 240, marginTop: 9 }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Skeleton style={{ height: 36, width: 200, borderRadius: 11 }} />
            <Skeleton style={{ height: 36, width: 100, borderRadius: 8 }} />
          </div>
        </div>

        <SkeletonTable rows={7} columns={5} />

        <div className="storage-meter">
          <Skeleton style={{ height: 11, width: 200 }} />
          <Skeleton style={{ height: 6, width: '100%', borderRadius: 6, marginTop: 10 }} />
        </div>
      </div>
    </SkeletonPage>
  );
}
