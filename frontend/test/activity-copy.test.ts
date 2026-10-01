/**
 * `composeActivity`.
 *
 * This composes the sentence a feed row shows. It is worth testing because it is
 * the only place user-facing text is assembled from database fields, and the
 * failure is a screen that says something subtly wrong rather than an exception:
 * "Leave pending" for an approved request, or a body that runs off the row.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeActivity, type ActivityRow } from '../lib/api';

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'a1',
    kind: 'message',
    read: false,
    createdAt: '2026-09-30T09:00:00.000Z',
    actor: { id: 'u2', name: 'Sarah Johnson', avatarUrl: null },
    target: null,
    ...overrides,
  };
}

describe('composeActivity', () => {
  it('names the actor and the channel for a message', () => {
    const { title, deletedTarget } = composeActivity(
      row({
        kind: 'message',
        target: { kind: 'message', id: 'm1', body: 'Deploy is green', channelName: 'general' },
      }),
    );

    assert.equal(title, 'Sarah Johnson sent a message in #general');
    assert.equal(deletedTarget, false);
  });

  it('omits the channel when there is none', () => {
    // A direct message has no channel, and "in #" would be worse than nothing.
    const { title } = composeActivity(
      row({ target: { kind: 'message', id: 'm1', body: 'hi', channelName: null } }),
    );

    assert.equal(title, 'Sarah Johnson sent a message');
    assert.ok(!title.includes('#'), `"${title}" should not contain an empty channel`);
  });

  it('truncates a long body rather than letting it overflow the row', () => {
    const { subtitle } = composeActivity(
      row({
        target: {
          kind: 'message',
          id: 'm1',
          body: 'x'.repeat(300),
          channelName: 'general',
        },
      }),
    );

    assert.ok(subtitle.length <= 91, `subtitle is ${subtitle.length} characters`);
    assert.ok(subtitle.endsWith('…'), 'a truncated body should say so');
  });

  it('leaves a short body untouched', () => {
    const { subtitle } = composeActivity(
      row({ target: { kind: 'message', id: 'm1', body: 'Deploy is green', channelName: null } }),
    );

    assert.equal(subtitle, 'Deploy is green');
  });

  it('says so when the target is gone, instead of inventing a name', () => {
    const { title, subtitle, deletedTarget } = composeActivity(row({ target: null }));

    assert.equal(deletedTarget, true, 'the caller needs to know to render this differently');
    assert.match(title, /removed/);
    assert.equal(subtitle, '', 'there is nothing honest to say about a missing target');
  });

  it('pluralises the day count in a leave row', () => {
    const one = composeActivity(
      row({
        kind: 'leave',
        target: { kind: 'leave', id: 'l1', status: 'PENDING', days: 1, from: '', to: '' },
      }),
    );
    const many = composeActivity(
      row({
        kind: 'leave',
        target: { kind: 'leave', id: 'l2', status: 'APPROVED', days: 3, from: '', to: '' },
      }),
    );

    assert.equal(one.subtitle, 'Sarah Johnson · 1 day');
    assert.equal(many.subtitle, 'Sarah Johnson · 3 days');
  });

  it('does not crash on a null actor', () => {
    // An actor can be gone -- deleted user, or a notification whose actor row was
    // removed -- and "Someone did a thing" beats throwing during a render.
    const { title } = composeActivity(
      row({
        actor: null,
        target: { kind: 'file', id: 'f1', name: 'api-spec.md', sizeBytes: '630' },
      }),
    );

    assert.equal(title, 'Someone shared a file');
  });

  it('switches on the target kind, not the notification kind', () => {
    // The two are correlated in practice but are separate unions, so the type
    // system cannot narrow on `row.kind`. This asserts the pairing the API
    // actually produces still renders as the target rather than as a fallback.
    const { title } = composeActivity(
      row({
        kind: 'message',
        target: { kind: 'file', id: 'f1', name: 'api-spec.md', sizeBytes: '630' },
      }),
    );

    assert.equal(title, 'Sarah Johnson shared a file');
  });
});
