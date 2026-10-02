/**
 * Messages.
 *
 * Pagination lives in `http/cursor.ts`, shared with the meeting transcript: both walk
 * the same `(createdAt, id)` pair and the tie-break on `id` is the part that is easy to
 * get subtly wrong, so there is one implementation rather than two.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { cursorWhere, decodeCursor, nextCursorFrom } from '../http/cursor.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { publish } from '../realtime/bus.js';
import { toMessageDto, type MessageDto } from '../dto.js';

const listQuery = z.object({
  channelId: z.string().min(1).max(64),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * The select that keeps every message response identical in shape.
 *
 * `parent` is joined rather than left out: a reply renders "Replying to Sarah" and
 * resolving that per message would be one query per row on screen. It is a single
 * join on the primary key, so the planner folds it into the same scan.
 */
const messageSelect = {
  id: true,
  channelId: true,
  // Selected so the DTO can say which conversation the message is in, and so the
  // edit/delete/react handlers below can publish to the right scope instead of
  // dropping a meeting message on the floor.
  meetingId: true,
  userId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  parentId: true,
  parent: { select: { userId: true, user: { select: { name: true } } } },
  reactions: { select: { emoji: true, userId: true } },
  attachments: { select: { id: true, name: true, sizeBytes: true, mimeType: true } },
} as const;

/** Whether the caller belongs to the team owning this channel. */
async function assertCanPostToChannel(userId: string, channelId: string): Promise<void> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, team: { select: { id: true } } },
  });
  if (!channel) throw notFound('No such channel.');

  // A private channel's real membership is not modelled yet, so team membership
  // is the only gate available. Widening this to a channel_members table is the
  // change that makes PRIVATE meaningful; see database/README.md.
  const member = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId: channel.team.id } },
    select: { id: true },
  });
  if (!member) throw forbidden('You are not a member of this team.');
}

/**
 * Publishes an edit or a deletion to whichever conversation the message is in.
 *
 * The guard used to be `if (message.channelId)`, which silently skipped every meeting
 * message: the row changed but nobody was told, so a room kept rendering the old text
 * until someone reloaded. A message belongs to a channel or a meeting and the two are
 * separate conversations, so the scope is taken from the row rather than assumed.
 *
 * A message with neither is not publishable -- which cannot happen, since `Message`
 * requires one of the two in practice -- and dropping it is the right failure: a
 * broadcast to no scope is a no-op, not a leak.
 */
function publishMessageEvent(
  kind: 'updated' | 'deleted',
  message: { id: string; channelId: string | null; meetingId: string | null },
  dto?: MessageDto,
): void {
  if (message.channelId) {
    publish(
      kind === 'updated'
        ? { type: 'message.updated', channelId: message.channelId, message: dto }
        : { type: 'message.deleted', channelId: message.channelId, messageId: message.id },
    );
    return;
  }

  if (message.meetingId) {
    publish(
      kind === 'updated'
        ? { type: 'meeting.message.updated', meetingId: message.meetingId, message: dto }
        : { type: 'meeting.message.deleted', meetingId: message.meetingId, messageId: message.id },
    );
  }
}

export function messagesRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { channelId, before, limit } = listQuery.parse(req.query);
    const cursor = decodeCursor(before);

    const rows = await prisma.message.findMany({
      where: {
        channelId,
        ...cursorWhere(cursor),
      },
      select: messageSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    // Fetched newest-first for the cursor, returned oldest-first because that is
    // the order a chat thread reads in, and it lets the client append a page
    // without reversing.
    const ordered = [...rows].reverse();

    sendJson(res, 200, {
      messages: ordered.map(toMessageDto),
      // Present only when a full page came back, so the client does not ask for
      // a further page that would be empty.
      nextCursor: nextCursorFrom(rows, limit),
    });
  });

  router.post('/', async (req, res) => {
    const body = z
      .object({
        channelId: z.string().min(1).max(64),
        // Empty is allowed so a message can be nothing but an attachment.
        body: z.string().max(4000).default(''),
        attachmentIds: z.array(z.string().min(1).max(64)).max(10).default([]),
        parentId: z.string().min(1).max(64).optional(),
      })
      .strict()
      .parse(req.body);

    if (!body.body.trim() && body.attachmentIds.length === 0) {
      throw badRequest('empty_message', 'A message needs text or an attachment.');
    }

    await assertCanPostToChannel(req.user!.id, body.channelId);

    // Validate the parent before writing: a reply to a message in another
    // channel would otherwise create a thread that belongs to two conversations.
    if (body.parentId) {
      const parent = await prisma.message.findUnique({
        where: { id: body.parentId },
        select: { channelId: true },
      });
      if (!parent) throw notFound('No such message to reply to.');
      if (parent.channelId !== body.channelId) {
        throw badRequest('parent_in_other_channel', 'A reply must be in the same channel as its parent.');
      }
    }

    const attachmentIds = [...new Set(body.attachmentIds)];
    if (attachmentIds.length > 0) {
      // Counted rather than trusted: connecting an id the caller did not upload
      // would attach someone else's file to their message.
      const owned = await prisma.file.count({
        where: { id: { in: attachmentIds }, uploadedById: req.user!.id, deletedAt: null },
      });
      if (owned !== attachmentIds.length) {
        throw badRequest('unknown_attachment', 'One of the attachments could not be used.');
      }
    }

    const row = await prisma.message.create({
      data: {
        channelId: body.channelId,
        userId: req.user!.id,
        body: body.body.trim(),
        parentId: body.parentId,
        attachments: { connect: attachmentIds.map((id) => ({ id })) },
      },
      select: messageSelect,
    });

    const dto = toMessageDto(row);
    publish({ type: 'message.created', channelId: body.channelId, message: dto });

    sendJson(res, 201, { message: dto });
  });

  /**
   * Edit, author only.
   *
   * The `editedAt` column and the `message.updated` broadcast both already existed
   * with nothing writing or reading them; this is the missing half rather than a new
   * feature.
   *
   * **No history.** The edit overwrites the body and a timestamp is all that
   * survives. That is a deliberate limit for a showcase: an edit history needs its
   * own table and a view, and a half-built one is worse than an honest "edited".
   */
  router.patch('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { body } = z
      .object({
        // Non-empty, unlike create. A message may be created with only an
        // attachment, but an edit that empties the text would leave an attachment
        // the author can no longer describe -- and there is no delete-the-edit path.
        body: z.string().min(1).max(4000),
      })
      .parse(req.body);

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, meetingId: true, userId: true, deletedAt: true },
    });
    if (!message) throw notFound('No such message.');

    if (message.userId !== req.user!.id) {
      throw forbidden('You can only edit your own messages.');
    }

    // Editing a tombstone would resurrect content in a thread where the original
    // is deliberately unreadable.
    if (message.deletedAt) throw badRequest('message_deleted', 'This message was deleted.');

    const trimmed = body.trim();
    if (!trimmed) throw badRequest('empty_body', 'An edited message cannot be empty.');

    const row = await prisma.message.update({
      where: { id },
      data: { body: trimmed, editedAt: new Date() },
      select: messageSelect,
    });

    publishMessageEvent('updated', message, toMessageDto(row));

    sendJson(res, 200, { message: toMessageDto(row) });
  });

  /** Adds a reaction, or removes it if the caller already gave that one. */
  router.post('/:id/reactions', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { emoji } = z
      .object({ emoji: z.string().min(1).max(16) })
      .parse(req.body);

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, meetingId: true, userId: true, deletedAt: true },
    });
    if (!message) throw notFound('No such message.');

    // A deleted message is a tombstone; reacting to it would resurrect content
    // in the feed without anyone being able to read what was said.
    if (message.deletedAt) throw badRequest('message_deleted', 'This message was deleted.');

    const existing = await prisma.reaction.findUnique({
      where: { userId_messageId_emoji: { userId: req.user!.id, messageId: id, emoji } },
      select: { id: true },
    });

    if (existing) {
      await prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      // A distinct id per reaction, so the (user, message, emoji) unique index
      // is what prevents a double-tap from creating two identical rows.
      await prisma.reaction.create({
        data: { id: `${id}-${emoji}-${req.user!.id}`, messageId: id, userId: req.user!.id, emoji },
      });
    }

    const row = await prisma.message.findUniqueOrThrow({ where: { id }, select: messageSelect });
    const dto = toMessageDto(row);
    publishMessageEvent('updated', message, dto);

    sendJson(res, 200, { message: dto });
  });

  /**
   * Soft delete, author only.
   *
   * The row stays and the body is emptied, so thread position, timestamps and
   * reactions stay coherent -- removing the row would leave replies pointing at
   * nothing and silently renumber the conversation. `deletedAt` is what makes it
   * a tombstone rather than an edit.
   */
  router.delete('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, meetingId: true, userId: true },
    });
    if (!message) throw notFound('No such message.');

    if (message.userId !== req.user!.id) {
      // Author-only, checked here rather than by role: a moderator deleting
      // someone's message is a different feature with an audit trail, and is not
      // this endpoint.
      throw forbidden('You can only delete your own messages.');
    }

    const row = await prisma.message.update({
      where: { id },
      data: { deletedAt: new Date(), body: '' },
      select: messageSelect,
    });

    publishMessageEvent('deleted', message);

    sendJson(res, 200, { message: toMessageDto(row) });
  });

  return router;
}
