'use client';

/**
 * The bridge between the API's meeting shape and the one `MeetingRoom` renders.
 *
 * `MeetingRoom` was written against the fixture type in `data.ts`, which carries
 * participant ids and an inline message array, while the API returns a joined
 * participant list and a separate transcript. Rather than rewrite the room for a
 * DTO, the fields it reads are mapped here -- one place, in the direction that lets
 * the room stay as it is.
 *
 * Shared by the meetings screen and the chat screen's call buttons, because both open
 * the same room. Two copies of this mapper would be two places for a shape change to
 * be applied to only one of them, which is exactly how a call opened from chat starts
 * rendering slightly differently from one opened from the meetings list.
 */

import type { MeetingDto } from './api';
import type { Meeting } from './data';

export type TranscriptMessage = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string };
};

export function toRoomMeeting(
  meeting: MeetingDto,
  messages: TranscriptMessage[],
): Meeting {
  return {
    id: meeting.id,
    title: meeting.title,
    roomName: meeting.roomName,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    organizerId: meeting.organizerId,
    participantIds: meeting.participants.map((p) => p.id),
    messages: messages.map((message) => ({
      id: message.id,
      authorId: message.author.id,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}