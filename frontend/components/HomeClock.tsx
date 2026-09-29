'use client';

import { useEffect, useState } from 'react';
import { Clock3, Timer } from 'lucide-react';
import type { CalendarEvent } from '@/lib/data';
import { formatTime } from '@/lib/format';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** "2h 14m" / "14m 03s" / "Starting soon". */
function countdownLabel(ms: number): string {
  if (ms <= 0) return 'Starting now';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * Live clock plus a countdown to the next event.
 *
 * Rendered on the client only. The server has no idea what time it is in the
 * viewer's browser, and this page is prerendered, so the first paint has to
 * agree with the server HTML or React reports a hydration mismatch. A fixed
 * placeholder is shown until mount, then replaced with real values.
 */
export function HomeClock({ events }: { events: CalendarEvent[] }) {
  const [now, setNow] = useState<Date | null>(null);
  // Announced every 30s rather than 1s: a screen reader reading a changing
  // number every second is unusable.
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();

    const everySecond = window.setInterval(tick, 1000);
    const everyThirty = window.setInterval(tick, 30_000);

    return () => {
      window.clearInterval(everySecond);
      window.clearInterval(everyThirty);
    };
  }, []);

  useEffect(() => {
    if (!now) return;
    setSpoken(
      `Time ${pad(now.getHours())}:${pad(now.getMinutes())}. ${now.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })}`,
    );
  }, [now]);

  const next = events
    .filter((event) => new Date(event.startsAt).getTime() > (now?.getTime() ?? Infinity))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];

  const remaining = next ? new Date(next.startsAt).getTime() - (now?.getTime() ?? 0) : null;

  return (
    <section className="home-clock" aria-label="Time and next event">
      <div className="home-clock-time">
        <span className="home-clock-icon">
          <Clock3 size={18} />
        </span>

        {now ? (
          <>
            {/* Suppressed because the seconds digit legitimately differs
                between the server render and the first client tick. */}
            <strong className="home-clock-digits" suppressHydrationWarning>
              {pad(now.getHours())}:{pad(now.getMinutes())}
              <small>:{pad(now.getSeconds())}</small>
            </strong>
            <span className="home-clock-date">
              {now.toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </>
        ) : (
          <>
            <strong className="home-clock-digits home-clock-placeholder">--:--</strong>
            <span className="home-clock-date">&nbsp;</span>
          </>
        )}

        <span className="sr-only" aria-live="polite">
          {spoken}
        </span>
      </div>

      <div className="home-clock-next">
        <span className="home-clock-icon">
          <Timer size={18} />
        </span>

        {next && remaining !== null ? (
          <>
            <div>
              <small>Next up</small>
              <strong>{next.title}</strong>
              <span className="home-clock-meta">
                {formatTime(next.startsAt)} &bull; {next.location} &bull;{' '}
                {next.attendeeIds.length} people
              </span>
            </div>
            <span className="home-clock-countdown">{countdownLabel(remaining)}</span>
          </>
        ) : (
          <div>
            <small>Next up</small>
            <strong>Nothing scheduled</strong>
            <span className="home-clock-meta">Your calendar is clear</span>
          </div>
        )}
      </div>
    </section>
  );
}
