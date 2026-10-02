/**
 * Meeting join tokens.
 *
 * ## Why the API mints this rather than the browser
 *
 * The API secret grants the power to mint a token for any room. Shipping it to the
 * browser would mean anyone could join a meeting they were not invited to. So the
 * browser asks this service for a token scoped to one room, and this service signs it
 * with a secret that never leaves the server. The same shape as
 * `realtime/ws-token.ts`, and for the same reason.
 *
 * ## The identity is the session, never the persona
 *
 * `identity` must be `req.user.id` -- the cookie holder. The frontend also has a
 * persona picker for demo convenience, which is deliberately *not* an authorisation
 * boundary, and using it here would let two browsers claim to be the same
 * participant: LiveKit evicts the first connection when the second joins under the
 * same identity. It would also re-open the bug where an incoming frame is
 * indistinguishable from your own.
 *
 * ## The room name is the meeting's own
 *
 * `Meeting.roomName` is already unique and already returned by `GET /api/meetings/:id`,
 * so two people opening the same meeting land in the same room by construction rather
 * than by a mapping that could drift.
 *
 * ## The TTL is short
 *
 * Five minutes: long enough to click Join and for the WebSocket handshake to complete,
 * short enough that a token sitting in a proxy log is close to worthless by the time
 * anyone reads it. Long-lived rooms reconnect with a fresh token rather than holding
 * one.
 */

import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';
import { config } from '../config.js';

/**
 * Join-token lifetime in seconds.
 *
 * Five minutes. The alternative -- an hour, which is what LiveKit's own docs use --
 * means a leaked token is a valid credential for the rest of the hour.
 */
export const MEETING_TOKEN_TTL_SECONDS = 5 * 60;

export type MeetingTokenInput = {
  /** `Meeting.roomName`. Not the meeting id: LiveKit rooms are named, not keyed. */
  roomName: string;
  /** The cookie holder's user id. */
  userId: string;
  /** Display name, so the participant list reads correctly without a directory call. */
  displayName: string;
};

/**
 * Mints a token that can join exactly one room as exactly one participant.
 *
 * Throws if the credentials are absent rather than returning null, because every
 * caller has already checked `livekitConfigured()` and a silent null here would turn
 * a configuration mistake into an unexplained join failure.
 */
export async function issueMeetingToken(input: MeetingTokenInput): Promise<{
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
}> {
  const apiKey = config.LIVEKIT_API_KEY;
  const apiSecret = config.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must both be set to mint a token.');
  }

  const options: AccessTokenOptions = {
    identity: input.userId,
    name: input.displayName,
    ttl: `${MEETING_TOKEN_TTL_SECONDS}s`,
  };

  // The credentials go in the constructor, not in the options object --
  // `AccessTokenOptions` carries ttl/name/identity/metadata only.
  const accessToken = new AccessToken(apiKey, apiSecret, options);

  // Only roomJoin, and only for this room. `canPublish` and friends are deliberately
  // left at their defaults so anyone in the meeting can be heard and seen; restricting
  // that is a product decision about viewer-versus-participant, not a technical one.
  accessToken.addGrant({ roomJoin: true, room: input.roomName });

  // Async in the v2 SDK -- `jsonwebtoken` was replaced with `jose`, which made the
  // signing APIs asynchronous. The v1 shape was a synchronous `toJWT()`.
  const token = await accessToken.toJwt();

  const expiresAt = new Date(Date.now() + MEETING_TOKEN_TTL_SECONDS * 1000).toISOString();

  return { token, expiresAt, expiresInSeconds: MEETING_TOKEN_TTL_SECONDS };
}