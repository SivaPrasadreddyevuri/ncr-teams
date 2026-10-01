/**
 * Calendar events.
 *
 * The assertions are about visibility and windows, because that is where a
 * calendar goes wrong quietly. A listing that returns one event too many is not
 * an obvious bug on the screen that renders it -- it is somebody's one-to-one
 * appearing in a colleague's week, discovered by the person it was about.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';

type EventDto = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  type: 'MEETING' | 'EVENT';
  organizerId: string;
  attendeeIds: string[];
  attendeeNames: string[];
  meetingId: string | null;
  location: string;
};

let harness: Harness;
let client: Client;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  client = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
});

after(async () => {
  await harness?.close();
});

async function list(query: string): Promise<{ events: EventDto[]; from: string; to: string }> {
  const response = await client.get(`/api/events${query}`);
  assert.equal(response.status, 200, `GET /api/events${query} returned ${response.status}`);
  return readJson(response);
}

/** An ISO timestamp `days` from now, at a fixed local-ish offset. */
function at(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('events', () => {
  it('returns events in the default window, soonest first', async () => {
    const { events } = await list('');

    assert.ok(events.length > 0, 'expected upcoming seeded events');

    const starts = events.map((e) => new Date(e.startsAt).getTime());
    for (let i = 1; i < starts.length; i += 1) {
      assert.ok(starts[i]! >= starts[i - 1]!, `out of order at index ${i}: ${events.map((e) => e.startsAt).join(', ')}`);
    }
  });

  it('returns names as well as ids for attendees', async () => {
    const { events } = await list('');
    const withAttendees = events.find((e) => e.attendeeIds.length > 0);

    assert.ok(withAttendees, 'expected an event with attendees');
    assert.equal(
      withAttendees!.attendeeNames.length,
      withAttendees!.attendeeIds.length,
      'names and ids must describe the same people',
    );
    assert.ok(
      withAttendees!.attendeeNames.every((name) => name.length > 0),
      `empty attendee name in ${JSON.stringify(withAttendees!.attendeeNames)}`,
    );
  });

  it('honours an explicit window', async () => {
    const { events, from, to } = await list(`?from=${at(2, 0)}&to=${at(4, 0)}`);

    assert.equal(from, at(2, 0), 'the response echoes the window it searched');
    assert.equal(to, at(4, 0));

    for (const event of events) {
      assert.ok(
        new Date(event.endsAt) > new Date(at(2, 0)) && new Date(event.startsAt) < new Date(at(4, 0)),
        `${event.title} (${event.startsAt} to ${event.endsAt}) does not overlap the window`,
      );
    }
  });

  it('includes an event that starts before the window but runs into it', async () => {
    // The overlap rule, not containment. An all-day or long-running event would
    // otherwise vanish from a calendar that is showing the day it continues in,
    // which is the one day it matters.
    await prisma.calendarEvent.create({
      data: {
        id: 'evt-overlap',
        title: 'Long running review',
        type: 'EVENT',
        // Starts yesterday, ends in three days' time.
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        organizerId: 'u1',
      },
    });

    try {
      const { events } = await list(`?from=${at(1, 0)}&to=${at(2, 0)}`);
      assert.ok(
        events.some((e) => e.id === 'evt-overlap'),
        'an event spanning the window should appear in it',
      );
    } finally {
      await prisma.calendarEvent.delete({ where: { id: 'evt-overlap' } });
    }
  });

  it('excludes an event entirely outside the window', async () => {
    await prisma.calendarEvent.create({
      data: {
        id: 'evt-elsewhere',
        title: 'Something next month',
        type: 'EVENT',
        startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3600_000),
        organizerId: 'u1',
      },
    });

    try {
      const { events } = await list(`?from=${at(1, 0)}&to=${at(2, 0)}`);
      assert.equal(
        events.some((e) => e.id === 'evt-elsewhere'),
        false,
        'an event a month out should not appear in a two-day window',
      );
    } finally {
      await prisma.calendarEvent.delete({ where: { id: 'evt-elsewhere' } });
    }
  });

  it('hides a meeting the caller neither organises nor attends', async () => {
    // The visibility rule. u1 sees company events regardless, so the probe has to
    // be a MEETING to be subject to the gate at all.
    //
    // Every create is inside the try, with an `id` to match on. An earlier
    // version created the rows before the try and omitted a required field, so the
    // create threw and the setup row was never deleted -- which failed a
    // completely unrelated test in another file with "9 teams, expected 8". A
    // test that can leave residue when its own setup fails is worse than no test.
    let eventId: string | null = null;
    try {
      const meeting = await prisma.meeting.create({
        data: {
          id: 'evt-probe-meeting',
          title: 'Private one to one',
          // Required and unique, not nullable -- the schema has no default.
          roomName: 'evt-probe-room',
          organizerId: 'u7',
          startsAt: new Date(Date.now() + 3600_000),
          endsAt: new Date(Date.now() + 7200_000),
        },
      });

      const event = await prisma.calendarEvent.create({
        data: {
          id: 'evt-probe-event',
          title: 'Private one to one',
          type: 'MEETING',
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          organizerId: 'u7',
          meetingId: meeting.id,
        },
      });
      eventId = event.id;

      const asEmployee = await list('');
      assert.equal(
        asEmployee.events.some((e) => e.id === event.id),
        false,
        'u1 does not organise or attend this meeting and should not see it',
      );

      const asHr = await signedInClient(harness, 'priya@company.com', TEST_PASSWORD);
      const asOrganiser = await asHr.get('/api/events');
      const organiserBody = await readJson<{ events: EventDto[] }>(asOrganiser);
      assert.ok(
        organiserBody.events.some((e) => e.id === event.id),
        'u7 organises it and should see it',
      );
    } finally {
      if (eventId) await prisma.calendarEvent.delete({ where: { id: eventId } });
      await prisma.meeting.deleteMany({ where: { id: 'evt-probe-meeting' } });
    }
  });

  it('shows a non-meeting event even when the caller is not invited', async () => {
    // The counterpart, so the gate above is not simply refusing everything. A
    // company-wide event is not private because nobody sent an invitation.
    const event = await prisma.calendarEvent.create({
      data: {
        id: 'evt-company-wide',
        title: 'All hands',
        type: 'EVENT',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        organizerId: 'u7',
      },
    });

    try {
      const { events } = await list('');
      assert.ok(events.some((e) => e.id === event.id), 'a non-meeting event should be visible to all');
    } finally {
      await prisma.calendarEvent.delete({ where: { id: event.id } });
    }
  });

  it('reports a window it searched, so "none here" is distinguishable from "none that far"', async () => {
    const { from, to } = await list('?days=7');
    const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);

    assert.ok(
      Math.abs(spanDays - 7) < 0.01,
      `expected a 7-day window, got ${spanDays.toFixed(2)}`,
    );
  });

  it('rejects an inverted window', async () => {
    const response = await client.get(`/api/events?from=${at(5, 0)}&to=${at(1, 0)}`);
    assert.equal(response.status, 400, 'from after to should be a 400');
  });

  it('rejects an unbounded request for far too much', async () => {
    const response = await client.get('/api/events?days=365');
    assert.equal(response.status, 400, 'days is capped, so a year is a 400');
  });

  it('requires a session', async () => {
    const response = await harness.client().get('/api/events');
    assert.equal(response.status, 401);
  });
});
