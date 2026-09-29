import { TeamsSkeleton } from '@/components/skeletons';

/**
 * Suspense fallback for /teams.
 *
 * The skeleton itself lives in components/skeletons so that RouteGate can
 * show the same shape on a client-side navigation. See the note in
 * pp/(app)/loading.tsx for why this does not currently fire: every route is
 * prerendered, so nothing suspends.
 */
export default function Loading() {
  return <TeamsSkeleton />;
}