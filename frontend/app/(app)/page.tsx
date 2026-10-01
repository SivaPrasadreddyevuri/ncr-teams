import Link from 'next/link';
import { SectionCard } from '@/components/SectionCard';
import { ActiveGreeting } from '@/components/home/ActiveGreeting';
import { HomeStats } from '@/components/home/HomeStats';
import { RecentActivityCard } from '@/components/home/RecentActivityCard';
import { HomeEventsProvider } from '@/components/home/HomeEventsProvider';
import { TodaysMeetingsCard } from '@/components/home/TodaysMeetingsCard';
import { HomeClock } from '@/components/HomeClock';
import { formatLongDate } from '@/lib/format';

/**
 * The dashboard.
 *
 * Still a server component, and that is the point of the shape here: the greeting
 * and today's date are prerendered, and the two pieces of live data -- the clock's
 * next meeting and the meetings card -- sit inside one client provider that
 * fetches them a single time.
 *
 * Making this whole page a client component would have been simpler and would have
 * thrown the prerendered heading away with it. See `lib/api.ts` for why the data
 * cannot be fetched here at all.
 */
export default function Home() {
  // Rendered on the server, so this is the server's date. The page's live date is
  // the clock's, which is client-side; this badge is the one deliberately static
  // value, and it reads as a build stamp rather than as "today".
  const buildDate = new Date();

  return (
    <HomeEventsProvider>
      <div className="welcome">
        <div>
          {/* Client-rendered: the name follows the signed-in persona and the
              greeting follows the real clock, neither of which a prerendered
              server component can know. */}
          <ActiveGreeting />
          <p>Here&apos;s what&apos;s happening with your teams today.</p>
        </div>
        <span className="welcome-badge">{formatLongDate(buildDate)}</span>
      </div>

      {/* Client-rendered: the server cannot know the viewer's clock. */}
      <HomeClock />

      <HomeStats />

      <div className="grid-2">
        <TodaysMeetingsCard />

        <RecentActivityCard />
      </div>
    </HomeEventsProvider>
  );
}
