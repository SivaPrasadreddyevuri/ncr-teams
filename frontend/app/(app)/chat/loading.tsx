import { Skeleton, SkeletonPage } from '@/components/Skeleton';

export default function Loading() {
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
