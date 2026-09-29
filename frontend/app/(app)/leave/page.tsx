import { SectionCard } from '@/components/SectionCard';

/**
 * Leave, for everyone.
 *
 * The submit form and the requester's own history land here in the next commit.
 * The route exists now so the nav entry added for it does not 404, and so the
 * page has a home to grow into that is separate from `/hr` -- employees must be
 * able to request time off without seeing anything HR-only.
 */
export default function LeavePage() {
  return (
    <div className="grid-2">
      <SectionCard title="Request leave">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          The request form is being added next.
        </p>
      </SectionCard>

      <SectionCard title="My requests">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          Your submitted requests will appear here.
        </p>
      </SectionCard>
    </div>
  );
}
