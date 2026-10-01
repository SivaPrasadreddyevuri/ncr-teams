/**
 * Files.
 *
 * Content lives in the `File.content` column, so a row and its bytes live and
 * die together. The earlier arrangement -- metadata in Postgres, bytes on local
 * disk -- could produce a row with no object behind it, because a free-tier
 * filesystem is wiped on every deploy. That state was reachable often enough to
 * need a 410 branch to explain it, and it no longer exists.
 *
 * ## Two things that got simpler
 *
 * **No path handling.** `File.storageKey` is still there, but it is an identity,
 * not a location, so nothing turns it into a filesystem path. The containment
 * checks, the exclusive-create flag and the partial-file cleanup all belonged to
 * a boundary that no longer exists.
 *
 * **Buffering is fine.** The cap is 5 MB, and the earlier "never buffer" rule was
 * about a 50 MB body on a small instance. Streaming mattered because the bytes
 * crossed a filesystem; now they cross a function call.
 */

import { Router } from 'express';
import Busboy from 'busboy';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { publish } from '../realtime/bus.js';
import { toFileDto } from '../dto.js';
import { config } from '../config.js';

const fileSelect = {
  id: true,
  name: true,
  sizeBytes: true,
  mimeType: true,
  isFolder: true,
  createdAt: true,
  deletedAt: true,
  content: true,
  team: { select: { name: true } },
  starredBy: { select: { id: true } },
} as const;

/** The most a client is told in a `Content-Disposition` header. */
const MAX_NAME_IN_HEADER = 200;

function contentDisposition(name: string): string {
  // A user-chosen name goes into a header, so quotes, backslashes and newlines
  // are replaced. Without this, a name containing a quote or a CRLF would let
  // someone inject response headers. Also truncated: a long name is not worth the
  // header risk, and a browser copes with a shortened one.
  const safe = name.replace(/[\r\n"\\]/g, '_').slice(0, MAX_NAME_IN_HEADER);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(
    name.slice(0, MAX_NAME_IN_HEADER),
  )}`;
}

/** Whether a row carries bytes. Folders never do -- a folder's content is its children. */
function hasContent(row: { content: Uint8Array | null; isFolder: boolean }): boolean {
  return !row.isFolder && row.content !== null;
}

export function filesRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const query = z
      .object({
        folderId: z.string().min(1).max(64).optional(),
        team: z.string().min(1).max(120).optional(),
        /**
         * Files shared into one channel.
         *
         * This is what the chat sidebar's Files tab reads. It exists because there
         * was no other way to ask the question: a file's channel is set at upload
         * and its message is set when it is attached, so "what was shared here" is a
         * column the listing could not filter on.
         */
        channelId: z.string().min(1).max(64).optional(),
        /** Include soft-deleted rows. Off by default. */
        includeDeleted: z.coerce.boolean().default(false),
      })
      .parse(req.query);

    const rows = await prisma.file.findMany({
      where: {
        deletedAt: query.includeDeleted ? { not: null } : null,
        // Exactly one of these is meaningful at a time -- a file is either at the
        // root of a channel or inside a folder -- so `folderId ?? null` keeps the
        // root-of-channel case working rather than silently returning everything.
        folderId: query.folderId ?? null,
        ...(query.channelId ? { channelId: query.channelId } : {}),
        ...(query.team ? { team: { name: query.team } } : {}),
      },
      select: fileSelect,
      orderBy: { createdAt: 'desc' },
    });

    sendJson(res, 200, {
      files: rows.map((row) => toFileDto(row, hasContent(row), req.user!.id)),
    });
  });

  /**
   * Multipart upload.
   *
   * The bytes are written in the same statement that creates the row, so there is
   * no window where a row exists without its content, or content without a row.
   */
  router.post('/', (req, res, next) => {
    const contentType = req.get('content-type');
    if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
      next(badRequest('not_multipart', 'Upload must be a multipart/form-data request.'));
      return;
    }

    let bus: Busboy.Busboy;
    try {
      bus = Busboy({ headers: req.headers, limits: { files: 1, fields: 10 } });
    } catch {
      next(badRequest('bad_multipart', 'The upload could not be read.'));
      return;
    }

    // Set before the handlers run: a failure can arrive in the same tick.
    let settled = false;
    const fail = (status: number, code: string, message: string) => {
      if (settled) return;
      settled = true;
      res.status(status).type('application/json').send(JSON.stringify({ error: { code, message } }));
    };

    const chunks: Buffer[] = [];
    const fields: Array<[string, string]> = [];
    let bytes = 0;
    let originalName = '';
    let declaredMime = 'application/octet-stream';
    let tooLarge = false;

    bus.on('field', (name, value) => {
      fields.push([name, value]);
    });

    bus.on('file', (_field, stream, info) => {
      originalName = info.filename || 'untitled';
      // A client-supplied Content-Type is a hint, not a fact. It is recorded but
      // never used to decide how to handle the bytes.
      declaredMime = info.mimeType || 'application/octet-stream';

      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > config.MAX_UPLOAD_BYTES) {
          // Stop immediately. Collecting it all and checking afterwards would let
          // a caller send an unbounded body.
          tooLarge = true;
          chunks.length = 0;
          stream.destroy();
        } else {
          chunks.push(chunk);
        }
      });
    });

    bus.on('filesLimit', () => fail(400, 'too_many_files', 'Upload one file at a time.'));
    bus.on('error', () => fail(400, 'bad_multipart', 'The upload could not be read.'));

    // A client that disconnects mid-upload. Without this the handler would try to
    // write a response to a request that is already gone.
    req.on('aborted', () => {
      settled = true;
    });

    bus.on('close', () => {
      void (async () => {
        try {
          if (settled) return;

          if (tooLarge) {
            fail(
              413,
              'file_too_large',
              `Uploads are limited to ${Math.floor(config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
            );
            return;
          }
          if (originalName === '') {
            fail(400, 'no_file', 'Include a file in the upload.');
            return;
          }
          if (bytes === 0) {
            // A folder's own bytes are its children, so a zero-length file is
            // almost always a mistake rather than an empty document.
            fail(400, 'empty_file', 'That file was empty.');
            return;
          }

          let folderId: string | undefined;
          let channelId: string | undefined;
          for (const [name, value] of fields) {
            if (name === 'folderId') folderId = value;
            if (name === 'channelId') channelId = value;
          }

          if (folderId) {
            const parent = await prisma.file.findUnique({
              where: { id: folderId },
              select: { id: true, isFolder: true, deletedAt: true },
            });
            if (!parent || !parent.isFolder || parent.deletedAt) {
              fail(400, 'bad_folder', 'That folder does not exist.');
              return;
            }
          }

          if (channelId) {
            const channel = await prisma.channel.findUnique({
              where: { id: channelId },
              select: { id: true },
            });
            if (!channel) {
              fail(400, 'bad_channel', 'That channel does not exist.');
              return;
            }
          }

          const row = await prisma.file.create({
            data: {
              name: originalName,
              mimeType: declaredMime,
              sizeBytes: BigInt(bytes),
              // Server-generated identity. The name is stored in `name` and used
              // only as a label -- it never becomes a path.
              storageKey: `uploads/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}`,
              content: Buffer.concat(chunks),
              uploadedById: req.user!.id,
              folderId: folderId ?? null,
              channelId: channelId ?? null,
            },
            select: fileSelect,
          });

          settled = true;
          const dto = toFileDto(row, true, req.user!.id);
          publish({ type: 'file.created', channelId: channelId ?? null, file: dto });
          sendJson(res, 201, { file: dto });
        } catch (error) {
          next(error);
        }
      })();
    });

    // Any error before `close` arrives here, and it must reach the error
    // middleware rather than being swallowed.
    req.pipe(bus);
  });

  /**
   * Downloads the bytes.
   *
   * A 410 rather than a 404 for a row with no content: the file is known to
   * exist and is gone, which is a different situation from never having had an
   * id. With the bytes in the database this is now rare -- a seeded row whose
   * content `demo:files` has not attached, or a soft-deleted file -- and a client
   * can say something useful about each.
   */
  router.get('/:id/download', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, name: true, mimeType: true, isFolder: true, content: true, sizeBytes: true },
    });
    if (!row || row.isFolder) throw notFound('No such file.');

    if (row.content === null) {
      throw new HttpError(
        410,
        'content_missing',
        'This file has no stored content. Run `npm run demo:files` to attach it to the seeded rows.',
      );
    }

    res.setHeader('content-type', row.mimeType);
    res.setHeader('content-length', row.sizeBytes.toString());
    res.setHeader('content-disposition', contentDisposition(row.name));
    // A file from the database is a user-supplied document, so the browser is
    // told not to guess a type and execute it.
    res.setHeader('x-content-type-options', 'nosniff');

    res.end(Buffer.from(row.content));
  });

  /** Toggles the caller's star. Per-user, so it is a relation, not a column. */
  router.post('/:id/star', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, starredBy: { where: { id: req.user!.id }, select: { id: true } } },
    });
    if (!row) throw notFound('No such file.');

    await prisma.file.update({
      where: { id },
      data: {
        starredBy:
          row.starredBy.length > 0
            ? { disconnect: [{ id: req.user!.id }] }
            : { connect: [{ id: req.user!.id }] },
      },
    });

    const fresh = await prisma.file.findUniqueOrThrow({ where: { id }, select: fileSelect });
    sendJson(res, 200, { file: toFileDto(fresh, hasContent(fresh), req.user!.id) });
  });

  /**
   * Soft delete, uploader only.
   *
   * The content is cleared as well as marking the row. A soft delete that leaves
   * the bytes means a "deleted" file is still one download away, which is not a
   * delete -- and with the bytes in the row, leaving them would also mean the
   * deleted row still occupies the space the delete was meant to reclaim.
   */
  router.delete('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, uploadedById: true, isFolder: true },
    });
    if (!row) throw notFound('No such file.');
    if (row.uploadedById !== req.user!.id) {
      throw badRequest('not_yours', 'You can only delete files you uploaded.');
    }

    // Refuses a non-empty folder rather than orphaning its children.
    if (row.isFolder) {
      const children = await prisma.file.count({ where: { folderId: id, deletedAt: null } });
      if (children > 0) {
        throw badRequest('folder_not_empty', 'Empty the folder before deleting it.');
      }
    }

    await prisma.file.update({ where: { id }, data: { deletedAt: new Date(), content: null } });

    sendJson(res, 200, { deleted: true, id });
  });

  return router;
}
