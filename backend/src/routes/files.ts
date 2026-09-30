/**
 * Files.
 *
 * Uploads are streamed from the request body straight to disk by busboy, never
 * buffered, and the size cap is enforced while the bytes are in flight. See
 * src/storage.ts for why that matters on a small instance.
 *
 * Bytes are addressed by `File.storageKey`, which is server-generated. A
 * client-supplied name is stored as `File.name` and used only as a label and a
 * `Content-Disposition` value -- never as a path.
 */

import { Router } from 'express';
import Busboy from 'busboy';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { publish } from '../realtime/bus.js';
import { toFileDto } from '../dto.js';
import * as storage from '../storage.js';
import { config } from '../config.js';

/**
 * The select shared by every file response.
 *
 * `storageKey` is selected because two routes need it to check whether bytes
 * still exist, and it is a server-generated key rather than a path, so reading it
 * is harmless. It is never returned: responses are built through `toFileDto`,
 * which names its fields explicitly instead of spreading the row.
 */
const fileSelect = {
  id: true,
  name: true,
  sizeBytes: true,
  mimeType: true,
  isFolder: true,
  createdAt: true,
  deletedAt: true,
  storageKey: true,
  team: { select: { name: true } },
  starredBy: { select: { id: true } },
} as const;

/**
 * `Content-Disposition` for a download.
 *
 * The filename is quoted and stripped of anything that could break out of the
 * header, because this value is built from a name a user chose. Without the
 * sanitising, a name containing a quote or a newline would let someone inject
 * response headers.
 */
function contentDisposition(name: string): string {
  const safe = name.replace(/[\r\n"\\]/g, '_');
  // The ASCII fallback form, plus a UTF-8 form so a name with accents still
  // arrives intact in a modern browser.
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function filesRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const query = z
      .object({
        folderId: z.string().min(1).max(64).optional(),
        team: z.string().min(1).max(120).optional(),
        /** Include soft-deleted rows. Off by default. */
        includeDeleted: z.coerce.boolean().default(false),
      })
      .parse(req.query);

    const rows = await prisma.file.findMany({
      where: {
        deletedAt: query.includeDeleted ? { not: null } : null,
        folderId: query.folderId ?? null,
        ...(query.team ? { team: { name: query.team } } : {}),
      },
      select: fileSelect,
      orderBy: { createdAt: 'desc' },
    });

    // Existence is checked per row so a row whose bytes were lost on a redeploy
    // reports `uploaded: false` instead of presenting a download that 404s.
    const dtos = await Promise.all(
      rows.map(async (row) => {
        const uploaded = row.isFolder ? false : await storage.exists(row.storageKey);
        return toFileDto(row, uploaded, req.user!.id);
      }),
    );

    sendJson(res, 200, { files: dtos });
  });

  /**
   * Multipart upload.
   *
   * Expects exactly one `file` part. `channelId` and `folderId` are optional
   * fields that place the file alongside a message or in a folder.
   */
  router.post('/', (req, res, next) => {
    const contentType = req.get('content-type');
    if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
      next(badRequest('not_multipart', 'Upload must be a multipart/form-data request.'));
      return;
    }

    let bus: Busboy.Busboy;
    try {
      bus = Busboy({
        headers: req.headers,
        // busboy owns the size cap, not `putStream`. It truncates the part and
        // keeps parsing, so the `close` event still arrives and the 413 can
        // actually be written.
        //
        // Letting `putStream` trip first was a real hang: its counter destroys
        // the read stream, which breaks the parser, so `close` never fired and
        // the request sat until the client timed out. The limit below is set one
        // byte lower than the counter's, making busboy the authority and leaving
        // the counter as a backstop that should never be reached.
        limits: { files: 1, fileSize: config.MAX_UPLOAD_BYTES, fields: 10 },
      });
    } catch {
      next(badRequest('bad_multipart', 'The upload could not be read.'));
      return;
    }

    // Set before the event handlers, since a failure can arrive in the same tick.
    let settled = false;
    const fail = (status: number, code: string, message: string) => {
      if (settled) return;
      settled = true;
      res.status(status).type('application/json').send(
        JSON.stringify({ error: { code, message } }),
      );
    };

    let storageKey: string | null = null;
    let originalName = '';
    let declaredMime = 'application/octet-stream';
    let folderId: string | undefined;
    let channelId: string | undefined;
    let upload: Promise<{ bytes: number }> | null = null;
    // busboy has no `fileSizeLimit` event. When a part exceeds `limits.fileSize`
    // it truncates the stream and sets this flag, so truncation is detected
    // here rather than by an event that never fires.
    let fileStream: (NodeJS.ReadableStream & { truncated?: boolean }) | null = null;

    bus.on('field', (name, value) => {
      if (name === 'folderId') folderId = value;
      if (name === 'channelId') channelId = value;
    });

    bus.on('file', (_field, stream, info) => {
      fileStream = stream;
      originalName = info.filename || 'untitled';
      // A client-supplied Content-Type is a hint, not a fact. It is recorded but
      // never used to decide how to handle the bytes.
      declaredMime = info.mimeType || 'application/octet-stream';
      storageKey = storage.newStorageKey(originalName);
      upload = storage.putStream(storageKey, stream, {
        maxBytes: config.MAX_UPLOAD_BYTES + 1,
      });
    });

    bus.on('filesLimit', () => {
      fail(400, 'too_many_files', 'Upload one file at a time.');
    });

    // A client that disconnects mid-upload. Without this the write would fail
    // into a request that is already gone.
    req.on('aborted', () => {
      settled = true;
    });

    bus.on('error', () => {
      fail(400, 'bad_multipart', 'The upload could not be read.');
    });

    bus.on('close', () => {
      void (async () => {
        try {
          // The client disconnected, or an earlier failure already answered.
          if (settled) return;

          if (fileStream?.truncated) {
            // busboy stopped at the cap and the rest of the body was read and
            // discarded, so the connection is still healthy and this 413 is
            // actually delivered. Clean up the truncated file first: a row
            // pointing at a partial upload is worse than no file.
            if (storageKey) await storage.deleteKey(storageKey);
            fail(413, 'file_too_large', `Uploads are limited to ${Math.floor(config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
            return;
          }

          if (!upload || !storageKey) {
            fail(400, 'no_file', 'Include a file in the upload.');
            return;
          }

          let written: { bytes: number };
          try {
            written = await upload;
          } catch (error) {
            if (error instanceof storage.StorageError && error.code === 'too_large') {
              await storage.deleteKey(storageKey);
              fail(413, 'file_too_large', error.message);
              return;
            }
            fail(400, 'upload_failed', 'The upload could not be saved.');
            return;
          }

          // A folder's own bytes are its children, so it has none. Refusing a
          // zero-length file keeps an accidental empty upload from looking like a
          // successful one.
          if (written.bytes === 0) {
            await storage.deleteKey(storageKey);
            fail(400, 'empty_file', 'That file was empty.');
            return;
          }

          if (folderId) {
            const parent = await prisma.file.findUnique({
              where: { id: folderId },
              select: { id: true, isFolder: true, deletedAt: true },
            });
            if (!parent || !parent.isFolder || parent.deletedAt) {
              await storage.deleteKey(storageKey);
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
              await storage.deleteKey(storageKey);
              fail(400, 'bad_channel', 'That channel does not exist.');
              return;
            }
          }

          const row = await prisma.file.create({
            data: {
              name: originalName,
              mimeType: declaredMime,
              sizeBytes: BigInt(written.bytes),
              storageKey,
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

    // Pipe the request body into the parser. Any error before `close` arrives
    // here, and it must reach the error middleware rather than being swallowed.
    req.pipe(bus);
  });

  /**
   * Downloads the bytes.
   *
   * A row with no bytes is a 410, not a 404: the file is known to exist and is
   * gone, which is a different situation from never having had one. A client can
   * tell "lost in a redeploy" from "bad id" and say something useful.
   */
  router.get('/:id/download', async (req, res, next) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, name: true, mimeType: true, isFolder: true, storageKey: true, sizeBytes: true },
    });
    if (!row || row.isFolder) throw notFound('No such file.');

    if (!(await storage.exists(row.storageKey))) {
      throw new HttpError(
        410,
        'content_missing',
        'This file has no stored content. Uploads do not survive a redeploy on the free tier.',
      );
    }

    res.setHeader('content-type', row.mimeType);
    res.setHeader('content-length', row.sizeBytes.toString());
    res.setHeader('content-disposition', contentDisposition(row.name));

    // A streamed body means a large download does not have to fit in memory to be
    // forwarded, and the client sees bytes start arriving immediately.
    const stream = storage.createReadStreamFor(row.storageKey);
    stream.on('error', (error) => next(error));
    stream.pipe(res);
  });

  /** Toggles the caller's star. Per-user, so it is a relation, not a column. */
  router.post('/:id/star', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, starredBy: { where: { id: req.user!.id }, select: { id: true } } },
    });
    if (!row) throw notFound('No such file.');

    if (row.starredBy.length > 0) {
      await prisma.file.update({
        where: { id },
        data: { starredBy: { disconnect: [{ id: req.user!.id }] } },
      });
    } else {
      await prisma.file.update({
        where: { id },
        data: { starredBy: { connect: [{ id: req.user!.id }] } },
      });
    }

    const fresh = await prisma.file.findUniqueOrThrow({ where: { id }, select: fileSelect });
    sendJson(res, 200, {
      file: toFileDto(fresh, await storage.exists(fresh.storageKey), req.user!.id),
    });
  });

  /**
   * Soft delete, uploader only.
   *
   * The bytes go too: a soft delete that leaves the object means a "deleted" file
   * is still one presigned URL away, which is not a delete.
   */
  router.delete('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.file.findUnique({
      where: { id },
      select: { id: true, uploadedById: true, isFolder: true, storageKey: true },
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

    await prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    if (!row.isFolder) await storage.deleteKey(row.storageKey);

    sendJson(res, 200, { deleted: true, id });
  });

  return router;
}
