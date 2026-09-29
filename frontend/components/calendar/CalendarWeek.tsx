'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import {
  APP_TIME_ZONE,
  appDayKey,
  appHour,
  appZoneOffsetMs,
  formatDayLabel,
  formatTime,
  startOfAppDay,
  weekDays,
  zoneParts,
} from '@/lib/format';
import type { CalendarEvent, Person } from '@/lib/data';

type View = 'week' | 'month' | 'day';

const HOURS = Array.from({ length: 12 }, (_, index) => index + 8);
const SLOT_H = 64;

export function CalendarWeek({
  initialEvents,
  people,
  currentUserId,
}: {
  initialEvents: CalendarEvent[];
  people: Person[];
  currentUserId: string;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<View>('week');
  // Phones open on a single full-width day; a five-column grid cannot fit
  // there and would scroll sideways. The day/week/month control lets the user
  // widen it. This runs after mount rather than in the state initialiser
  // because reading window during the first render would make the client
  // disagree with the server HTML -- a hydration mismatch.
  useEffect(() => {
    if (window.innerWidth <= 760) setView('day');
  }, []);
  // Mon-Fri by default, which is what the reference shows.
  const [dayCount, setDayCount] = useState<5 | 7>(5);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dayKey, setDayKey] = useState(() => appDayKey(new Date()));

  // In day view the grid renders a single column, so the whole week layout --
  // hour ruler, day head, absolutely positioned events -- is reused unchanged
  // rather than duplicated. This is what lets a phone show one full-width day
  // with no sideways scroll.
  //
  // The day shown is the anchor's own app-zone day, NOT the Monday of its week.
  // Deriving it from the week would pin day view to Monday and make the Next
  // and Previous buttons look broken: the anchor moves but the column does not.
  const days = useMemo(
    () => (view === 'day' ? [startOfAppDay(anchor)] : weekDays(anchor, dayCount)),
    [anchor, dayCount, view],
  );
  const todayKey = appDayKey(new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = appDayKey(new Date(event.startsAt));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  const weekLabel =
    view === 'day'
      ? days[0].toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: APP_TIME_ZONE,
        })
      : `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })} \u2013 ${days[days.length - 1].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })}`;

  function shift(direction: number) {
    // The anchor is an app-zone midnight. Adding whole days is exact because
    // APP_TIME_ZONE has no DST; setUTCMonth would be off by an hour across a
    // month boundary, so month stepping goes through Date.UTC on the parts.
    if (view === 'week') {
      setAnchor(new Date(anchor.getTime() + direction * 7 * 86_400_000));
      return;
    }

    if (view === 'day') {
      setAnchor(new Date(anchor.getTime() + direction * 86_400_000));
      return;
    }

    const { year, month, day } = zoneParts(anchor);
    const shifted = new Date(Date.UTC(year, month - 1 + direction, day));
    setAnchor(new Date(shifted.getTime() - appZoneOffsetMs()));
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const label = title.trim();
    if (!label) return;

    const [year, month, day] = dayKey.split('-').map(Number);
    const start = new Date(year, month - 1, day, 10, 0, 0);

    setEvents((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        title: label,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
        type: 'EVENT',
        organizerId: currentUserId,
        attendeeIds: [currentUserId],
        meetingId: null,
        location: 'Personal',
      },
    ]);

    setTitle('');
    setAdding(false);
  }

  function remove(eventId: string) {
    setEvents((current) => current.filter((event) => event.id !== eventId));
  }

  return (
    <div className="calendar">
      <div className="calendar-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-btn" type="button" onClick={() => shift(-1)} aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" type="button" onClick={() => shift(1)} aria-label="Next">
            <ChevronRight size={16} />
          </button>
          <button className="join" type="button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <strong className="cal-label">{weekLabel}</strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="segmented cal-view-toggle" role="group" aria-label="Calendar view">
            {(['day', 'week', 'month'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={view === option ? 'active' : ''}
                onClick={() => setView(option)}
                aria-pressed={view === option}
              >
                {option === 'day' ? 'Day' : option === 'week' ? (dayCount === 5 ? 'Work week' : 'Week') : 'Month'}
              </button>
            ))}
          </div>

          {view === 'week' && (
            <div className="segmented cal-days-toggle" role="group" aria-label="Days shown">
              {([5, 7] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={dayCount === option ? 'active' : ''}
                  onClick={() => setDayCount(option)}
                  aria-pressed={dayCount === option}
                >
                  {option} days
                </button>
              ))}
            </div>
          )}

          <button className="join" type="button" onClick={() => setAdding((c) => !c)}>
            <Plus size={15} /> New event
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={add} style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <div className="form-field">
            <label htmlFor="event-title">Title</label>
            <input
              id="event-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What is happening?"
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="event-date">Date</label>
            <input
              id="event-date"
              type="date"
              value={dayKey}
              onChange={(event) => setDayKey(event.target.value)}
            />
          </div>

          <button className="primary" type="submit" disabled={!title.trim()}>
            Add event
          </button>
        </form>
      )}

      {view !== 'month' ? (
        <div
          className="calendar-week"
          // Only the count travels inline. The `grid-template-columns`
          // declaration itself lives in CSS so media queries can still
          // override it -- an inline declaration would outrank them.
          data-days={days.length}
          style={{ '--cols': days.length } as React.CSSProperties}
        >
          <div className="calendar-hours" />
          {days.map((day) => {
            const isToday = appDayKey(day) === todayKey;
            return (
              <div className="calendar-day" data-today={isToday} key={day.toISOString()}>
                <div className="calendar-day-head">
                  <span>{day.toLocaleDateString('en-GB', { weekday: 'short', timeZone: APP_TIME_ZONE })}</span>
                  {isToday ? <span className="today-pill">{appDayKey(day).slice(8)}</span> : <span>{appDayKey(day).slice(8)}</span>}
                </div>
              </div>
            );
          })}

          <div className="calendar-hours">
            {HOURS.map((hour) => (
              <div key={hour}>{String(hour).padStart(2, '0')}:00</div>
            ))}
          </div>

          {days.map((day) => {
            const key = appDayKey(day);
            return (
              <div className="calendar-day" data-today={key === todayKey} key={`body-${key}`}>
                <div className="calendar-day-body">
                  {HOURS.map((hour) => (
                    <div className="calendar-slot" key={hour} />
                  ))}

                  {(byDay.get(key) ?? []).map((event) => {
                    const start = new Date(event.startsAt);
                    const minutes = (new Date(event.endsAt).getTime() - start.getTime()) / 60_000;
                    const height = Math.max(26, (minutes / 60) * SLOT_H - 4);
                    // Progressive disclosure: a 30-minute slot has room for a
                    // title only, an hour adds the time, anything longer adds
                    // the attendee avatars.
                    const size = height < 46 ? '' : height < 80 ? ' tall' : ' tall xtall';

                    return (
                      <div
                        className={`event calendar-event${size}`}
                        key={event.id}
                        style={{
                          position: 'absolute',
                          top: ((appHour(start) - 8) / 1) * SLOT_H + 2,
                          height,
                          left: 3,
                          right: 3,
                        }}
                      >
                        <div>
                          <strong>{event.title}</strong>
                          <small className="ev-detail">
                            {formatTime(event.startsAt)} &bull; {event.location}
                          </small>
                        </div>

                        <div className="ev-foot">
                          <div className="avatar-stack">
                            {event.attendeeIds.slice(0, 3).map((id) => {
                              const person = people.find((p) => p.id === id);
                              if (!person) return null;
                              return <PersonAvatar key={id} person={person} size="sm" />;
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(event.id)}
                            aria-label={`Delete ${event.title}`}
                            title="Remove event"
                            style={{ marginLeft: 'auto' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="calendar-grid"
          style={{ '--cols': days.length } as React.CSSProperties}
        >
          {days.map((day) => {
            const key = appDayKey(day);
            const list = byDay.get(key) ?? [];
            return (
              <div key={key} data-today={key === todayKey}>
                <strong>{appDayKey(day).slice(8)}</strong>
                {list.map((event) => (
                  <div className="event" key={event.id} style={{ marginTop: 4 }}>
                    <CalendarDays size={11} /> {event.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="calendar-legend">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: '#2991f1' }} /> Meeting
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: '#8b5cf6' }} /> Event
        </span>
        <span>{events.length} items in view &bull; changes are not saved</span>
      </div>
    </div>
  );
}
