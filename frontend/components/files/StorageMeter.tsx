'use client';

import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { estimateUsage } from '@/lib/idb';
import { formatBytes } from '@/lib/format';

/**
 * Storage actually used, from the browser's own accounting.
 *
 * This replaced a hardcoded `STORAGE_QUOTA_BYTES = 50GB`, which was never
 * anything but a constant. The moment uploads stored real bytes, a meter
 * claiming 50GB of headroom would have been telling the user something
 * demonstrably false about a limit the browser was already enforcing.
 */
export function StorageMeter({ uploadedBytes, uploadedCount }: { uploadedBytes: number; uploadedCount: number }) {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    let live = true;
    void estimateUsage().then((next) => {
      if (live) setUsage(next);
    });
    return () => { live = false; };
  }, [uploadedBytes, uploadedCount]);

  // No estimate available: an older browser, or a private window that refuses.
  // Report what we can rather than inventing a quota.
  const hasEstimate = usage && usage.quota > 0;
  const used = hasEstimate ? usage!.usage : uploadedBytes;
  const quota = hasEstimate ? usage!.quota : 0;
  const percent = hasEstimate ? Math.min(100, (used / quota) * 100) : 0;

  return (
    <div className="storage-meter">
      <span className="storage-label">
        <HardDrive size={13} />
        {hasEstimate ? 'Browser storage used' : 'Stored by this browser'}
      </span>

      <div
        className="meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="Storage used"
      >
        <span style={{ width: `${Math.max(percent, uploadedBytes > 0 ? 2 : 0)}%` }} />
      </div>

      <span className="storage-value">
        {hasEstimate
          ? `${formatBytes(used)} of ${formatBytes(quota)}`
          : `${formatBytes(uploadedBytes)} uploaded`}
        {uploadedCount > 0 && ` · ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
