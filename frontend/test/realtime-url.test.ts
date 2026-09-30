/**
 * Socket URL resolution.
 *
 * This is the one part of the realtime client that is a pure function of its
 * input, and also the part whose failure is invisible. Everything else in
 * lib/realtime.ts fails loudly -- a bad frame, a closed socket, a rejected token
 * all produce a visible event or a status change. A wrong host produces a socket
 * that simply never opens, so the test suite cannot reach it over the network and
 * has to check the string instead.
 *
 * Run from the repository root:
 *   npm run test --workspace frontend
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSocketUrl } from '../lib/realtime';

const PAGE = { protocol: 'https:', host: 'ncr-teams.vercel.app' };

describe('resolveSocketUrl', () => {
  it('uses a configured wss:// URL as given', () => {
    assert.equal(
      resolveSocketUrl('wss://api.example.com/ws', PAGE, true),
      'wss://api.example.com/ws',
    );
  });

  it('appends /ws to a bare origin, which is the common paste', () => {
    assert.equal(
      resolveSocketUrl('wss://api.example.com', PAGE, true),
      'wss://api.example.com/ws',
    );
  });

  it('treats a trailing slash as a bare origin', () => {
    assert.equal(
      resolveSocketUrl('wss://api.example.com/', PAGE, true),
      'wss://api.example.com/ws',
    );
  });

  it('upgrades https to wss, since that is what the operator meant', () => {
    assert.equal(
      resolveSocketUrl('https://api.example.com', PAGE, true),
      'wss://api.example.com/ws',
    );
  });

  it('upgrades http to ws', () => {
    assert.equal(
      resolveSocketUrl('http://127.0.0.1:4000', { protocol: 'http:', host: 'localhost:3000' }, false),
      'ws://127.0.0.1:4000/ws',
    );
  });

  it('rejects a non-websocket scheme rather than guessing at it', () => {
    // Rewriting an unknown scheme into ws:// would hide a typo that can never
    // work, so this is an error naming the variable instead.
    assert.throws(
      () => resolveSocketUrl('ftp://api.example.com/ws', PAGE, true),
      /NEXT_PUBLIC_WS_URL must be a ws/,
    );
  });

  it('rejects a value that is not a URL at all', () => {
    assert.throws(
      () => resolveSocketUrl('ncr-teams-api.onrender.com', PAGE, true),
      /is not a valid URL/,
    );
  });

  it('names the offending value, so the console message is actionable', () => {
    assert.throws(
      () => resolveSocketUrl('nope', PAGE, true),
      /"nope"/,
    );
  });

  it('falls back to the page origin, matching its scheme', () => {
    assert.equal(resolveSocketUrl(undefined, PAGE, true), 'wss://ncr-teams.vercel.app/ws');
    assert.equal(
      resolveSocketUrl(undefined, { protocol: 'http:', host: 'localhost:3000' }, false),
      'ws://localhost:3000/ws',
    );
  });

  it('keeps a query string on a configured URL, so the token can be appended', () => {
    // The client appends the token with the URL API. If this dropped the
    // existing query the operator would silently lose whatever they put there.
    assert.equal(
      resolveSocketUrl('wss://api.example.com/ws?tenant=demo', PAGE, true),
      'wss://api.example.com/ws?tenant=demo',
    );
  });

  it('appends the token to a URL that already has a query, producing one ?', () => {
    // The regression this guards: `?token=` concatenated onto a URL that already
    // had a query would send "tenant" as the parameter name and the token as its
    // value, so the server would reject the handshake with no visible cause.
    const base = resolveSocketUrl('wss://api.example.com/ws?tenant=demo', PAGE, true);
    const url = new URL(base);
    url.searchParams.set('token', 'a b/c+d');

    assert.equal(url.searchParams.get('tenant'), 'demo');
    assert.equal(url.searchParams.get('token'), 'a b/c+d');
    assert.equal(url.toString(), 'wss://api.example.com/ws?tenant=demo&token=a+b%2Fc%2Bd');
  });
});
