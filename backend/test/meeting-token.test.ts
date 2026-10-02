/**
 * Meeting join tokens.
 *
 * ## Why this file sets its own environment
 *
 * `config.ts` validates once at import, so a test that wants LiveKit configured has
 * to arrange it *before* anything imports the config. Node runs each test file in its
 * own process, so setting the two variables here and then dynamically importing the
 * token module is safe -- no other suite sees them.
 *
 * The credentials are deliberately fake. Signing is a local HMAC, so nothing is sent
 * to LiveKit and no account is required; what is under test is the *shape* of the
 * claim, which is exactly what a wrong key, a forgotten `await`, or an over-broad
 * grant would break.
 *
 * ## What is actually being defended
 *
 * **Identity comes from the session, not the persona.** The frontend has a persona
 * picker for demo convenience. If it ever fed the token's identity, two browsers could
 * claim one participant and LiveKit would evict the first connection on the second
 * join. The subject here is asserted explicitly because that is the field that would
 * silently carry the wrong value.
 *
 * **The grant is narrow.** `roomJoin` for one named room, and nothing else. An admin
 * grant would let a participant end calls or remove people.
 *
 * **Publishing is left alone.** `canPublish` stays at LiveKit's default rather than
 * being set to true explicitly, so restricting who may be heard remains a decision
 * rather than a constant someone can read as settled.
 */

import './setup-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';

// Set after setup-env (which supplies DATABASE_URL and friends) but before the
// dynamic import below, because `config.ts` reads the environment once when it is
// first evaluated and nothing may import it before this line.
process.env.LIVEKIT_API_KEY = 'APIprobeKey123';
process.env.LIVEKIT_API_SECRET = 'probe-secret-value-not-a-real-livekit-credential';

const { issueMeetingToken, MEETING_TOKEN_TTL_SECONDS } = await import('../src/livekit/token.js');

type Claims = {
  iss: string;
  sub: string;
  name: string;
  nbf: number;
  exp: number;
  video?: {
    roomJoin?: boolean;
    room?: string;
    canPublish?: boolean;
    roomAdmin?: boolean;
    roomCreate?: boolean;
    roomRecord?: boolean;
    roomList?: boolean;
  };
};

/** Decodes the payload without verifying it -- the signature is the SDK's concern. */
function claimsOf(token: string): Claims {
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'a JWT has three dot-separated segments');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Claims;
}

describe('meeting token: the claim', () => {
  it('is signed by the configured API key', async () => {
    const { token } = await issueMeetingToken({
      roomName: 'room-probe',
      userId: 'u1',
      displayName: 'Alex Johnson',
    });

    assert.equal(claimsOf(token).iss, 'APIprobeKey123');
  });

  it('carries the session user as its identity, not a persona', async () => {
    const { token } = await issueMeetingToken({
      roomName: 'room-probe',
      userId: 'u7',
      displayName: 'Priya Nair',
    });

    const claims = claimsOf(token);
    // `sub` is the identity LiveKit uses to evict a duplicate connection, so a wrong
    // value here means two browsers cannot be in the same room.
    assert.equal(claims.sub, 'u7');
    assert.equal(claims.name, 'Priya Nair');
  });

  it('grants roomJoin for exactly the room asked for', async () => {
    const { token } = await issueMeetingToken({
      roomName: 'room-q2-roadmap',
      userId: 'u1',
      displayName: 'Alex Johnson',
    });

    const { video } = claimsOf(token);
    assert.equal(video?.roomJoin, true);
    assert.equal(video?.room, 'room-q2-roadmap');
  });

  it('grants nothing beyond joining', async () => {
    const { token } = await issueMeetingToken({
      roomName: 'room-probe',
      userId: 'u1',
      displayName: 'Alex Johnson',
    });

    const { video } = claimsOf(token);
    // An admin or record grant would let a participant end calls or start recording.
    assert.notEqual(video?.roomAdmin, true);
    assert.notEqual(video?.roomCreate, true);
    assert.notEqual(video?.roomRecord, true);
  });

  it('leaves publishing at the SDK default rather than deciding it here', async () => {
    const { token } = await issueMeetingToken({
      roomName: 'room-probe',
      userId: 'u1',
      displayName: 'Alex Johnson',
    });

    // Absent, not `true`. Anyone in the meeting can be heard and seen, and narrowing
    // that is a product decision, not something this module should hard-code.
    assert.equal(claimsOf(token).video?.canPublish, undefined);
  });

  it('expires in five minutes', async () => {
    const minted = await issueMeetingToken({
      roomName: 'room-probe',
      userId: 'u1',
      displayName: 'Alex Johnson',
    });

    assert.equal(MEETING_TOKEN_TTL_SECONDS, 300);
    assert.equal(minted.expiresInSeconds, 300);

    const claims = claimsOf(minted.token);
    assert.equal(claims.exp - claims.nbf, 300);

    // And the advertised expiry matches the claim, so the client is not told one thing
    // and handed another.
    const advertised = new Date(minted.expiresAt).getTime() / 1000;
    assert.ok(Math.abs(advertised - claims.exp) < 5, 'expiresAt must agree with the claim');
  });

  it('mints a distinct token per room, so two meetings cannot share an identity', async () => {
    const first = await issueMeetingToken({ roomName: 'room-a', userId: 'u1', displayName: 'Alex' });
    const second = await issueMeetingToken({ roomName: 'room-b', userId: 'u1', displayName: 'Alex' });

    assert.notEqual(first.token, second.token);
    assert.equal(claimsOf(first.token).video?.room, 'room-a');
    assert.equal(claimsOf(second.token).video?.room, 'room-b');
  });
});

describe('meeting token: without credentials', () => {
  /**
   * Runs in a child process.
   *
   * `setup-env` loads the developer's real `backend/.env`, so once you paste a LiveKit
   * secret there the suite would have credentials -- and an in-process test of the
   * unconfigured path would start failing depending on whether you had done that. A
   * fresh process with the variables stripped is deterministic either way, which is
   * what a test of this branch has to be.
   */
  it('throws rather than minting an unusable token', () => {
    const script = `
      import './setup-env.js';
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
      const { issueMeetingToken } = await import('../src/livekit/token.js');
      try {
        await issueMeetingToken({ roomName: 'r', userId: 'u1', displayName: 'A' });
        console.log('RESULT: minted-without-credentials');
      } catch (error) {
        console.log('RESULT: threw: ' + error.message);
      }
    `;

    const scriptPath = fileURLToPath(new URL('./meeting-token-guard.mts', import.meta.url));
    writeFileSync(scriptPath, script, 'utf8');

    try {
      const out = execFileSync(process.execPath, ['--import', 'tsx', scriptPath], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      });

      assert.match(
        out,
        /RESULT: threw: LIVEKIT_API_KEY and LIVEKIT_API_SECRET/,
        `expected a clear refusal, got: ${out.trim()}`,
      );
    } finally {
      rmSync(scriptPath, { force: true });
    }
  });
});