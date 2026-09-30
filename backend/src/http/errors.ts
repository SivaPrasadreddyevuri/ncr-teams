/**
 * Errors and the JSON error envelope.
 *
 * Every failure reaching the client is `{ error: { code, message } }`. A stack
 * trace, a Prisma message or a SQL fragment is never sent: those describe the
 * schema and the host, which is free reconnaissance.
 */

import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { isProduction } from '../config.js';
import { sendJson } from '../serialise.js';

/** An error carrying the HTTP status and machine-readable code to return. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields merged into the response body. Used by 2FA to return a token. */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(400, code, message, details);

export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this.') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);

/** A `User` as far as middleware and handlers are concerned. */
export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';
  avatarUrl: string | null;
  departmentId: string | null;
};

/**
 * Prisma's own "record not found" is an internal-sounding error. Callers that
 * expect absence should check for it rather than leaking it.
 */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): HttpError | null {
  switch (error.code) {
    // A unique violation on an upsert race, or a foreign key that vanished
    // between validation and write.
    case 'P2002':
    case 'P2003':
      return new HttpError(409, 'conflict', 'That change conflicts with existing data.');
    // P2025 is "record required but not found", which for a request means a 404.
    case 'P2025':
      return notFound();
    default:
      return null;
  }
}

/**
 * Terminal error middleware.
 *
 * A single funnel, so a route cannot accidentally answer with a raw `Error` and
 * leak internals: anything not recognised is logged in full and reported as a
 * generic 500.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Headers already sent means the response is committed; delegating is the only
  // correct move, and Express needs its default handler to close the socket.
  if (res.headersSent) {
    next(error);
    return;
  }

  // Validation failures are the caller's to fix, so the field paths are useful
  // to return -- unlike an internal error, which says nothing to the client.
  if (error instanceof ZodError) {
    sendJson(res, 400, {
      error: {
        code: 'validation_failed',
        message: 'The request body or query string is invalid.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, ...error.details },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = fromPrisma(error);
    if (mapped) {
      sendJson(res, mapped.status, {
        error: { code: mapped.code, message: mapped.message },
      });
      return;
    }
  }

  // A JSON body that will not parse: body-parser sets `type` on the error.
  if (error instanceof SyntaxError && 'body' in error) {
    sendJson(res, 400, {
      error: { code: 'malformed_json', message: 'The request body is not valid JSON.' },
    });
    return;
  }

  // Anything reaching here is a bug. Log it with enough context to find it,
  // answer with nothing that helps an attacker.
  console.error(`[error] ${req.method} ${req.originalUrl}`, error);

  sendJson(res, 500, {
    error: {
      code: 'internal_error',
      // The real message in development, because a stack trace in the terminal
      // is useless when the client only ever saw "Internal Server Error".
      message: isProduction ? 'Something went wrong.' : String((error as Error)?.message ?? error),
    },
  });
}

/** 404 for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  sendJson(res, 404, {
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}.` },
  });
}
