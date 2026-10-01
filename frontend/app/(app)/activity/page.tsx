import { ActivityScreen } from '@/components/activity/ActivityScreen';

/**
 * The page is a shell; the screen is the client component.
 *
 * The split exists because the data needs the session cookie, which lives in the
 * browser. Keeping the route file free of `'use client'` leaves room for a
 * server-rendered heading later without unpicking the data fetching.
 */
export default function ActivityPage() {
  return <ActivityScreen />;
}
