'use client';

import { useEffect, useState } from 'react';
import { Clock3, Timer } from 'lucide-react';
import type { CalendarEvent } from '@/lib/data';
import { formatTime } from '@/lib/format';
import { readJson, storageKeys, writeJson } from '@/lib/storage';

type ClockFormat = '12h' | '24h';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * Hours as they should be displayed.
 *
 * `h % 12 || 12` is the whole trick: it maps midnight 0 -> 12 and leaves noon 12
 * alone, which `h % 12` on its own would render as "0:30 PM".
 */
function displayHours(hours24: number, format: ClockFormat) {
  if (format === '24h') return hours24;
  return hours24 % 12 || 12;
}

/** AM/PM is omitted in 24-hour mode, where it would be redundant. */
function meridiem(hours24: number) {
  return hours24 < 12 ? 'AM' : 'PM';
}

/** "2h 14m" / "14m 03s" / "Starting now". */
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
  const [format, setFormat] = useState<ClockFormat>('12h');
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

  // Restored after mount rather than read during render. localStorage does not
  // exist on the server, and even where it does, the server has no way to know
  // the stored preference -- reading it in render would be a mismatch.
  useEffect(() => {
    const stored = readJson<ClockFormat>(storageKeys.clockFormat);
    if (stored === '12h' || stored === '24h') setFormat(stored);
  }, []);

  function chooseFormat(next: ClockFormat) {
    setFormat(next);
    writeJson(storageKeys.clockFormat, next);
  }

  useEffect(() => {
    if (!now) return;
    setSpoken(
      `Time ${displayHours(now.getHours(), format)}:${pad(now.getMinutes())} ${
        format === '12h' ? meridiem(now.getHours()) : ''
      }`,
    );
  }, [now, format]);

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
              {displayHours(now.getHours(), format)}:{pad(now.getMinutes())}
              <small>:{pad(now.getSeconds())}</small>
              {format === '12h' && <small className="home-clock-meridiem"> {meridiem(now.getHours())}</small>}
            </strong>
          </>
        ) : (
          <strong className="home-clock-digits home-clock-placeholder">--:--</strong>
        )}

        <div className="segmented home-clock-format" role="group" aria-label="Clock format">
          {(['12h', '24h'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={format === option ? 'active' : ''}
              onClick={() => chooseFormat(option)}
              aria-pressed={format === option}
            >
              {option}
            </button>
          ))}
        </div>

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
