import { GenericSkeleton } from '@/components/skeletons';

/**
 * Default loading state for every authenticated route.
 *
 * Because the shell lives in `app/(app)/layout.tsx`, this renders *inside* the
 * sidebar and topbar: navigation paints immediately and only the page body is
 * replaced, instead of the whole viewport flashing.
 *
 * Every route here is prerendered, so in practice Suspense never suspends and
 * this file does not fire — `RouteGate` is what makes a loading state visible,
 * on client-side navigation. This stays because it is the correct mechanism the
 * moment a route needs real data, and it shares the skeleton definitions rather
 * than duplicating them.
 */
export default function Loading() {
  return <GenericSkeleton />;
}
