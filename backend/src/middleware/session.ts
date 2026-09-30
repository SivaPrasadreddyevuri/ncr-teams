/**
 * Request middleware: session resolution, authentication, CSRF, role guards.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { csrfHeaderName, sessionCookieName } from '../config.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { csrfSecretsMatch } from '../auth/token.js';
import { resolveSession, touchSession } from '../auth/session-store.js';
import type { AuthenticatedUser } from '../http/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Awaited<ReturnType<typeof resolveSession>>;
    user?: AuthenticatedUser;
  }
}

/**
 * Resolves the session cookie onto `req.session` and `req.user`.
 *
 * Never rejects. A request with no valid session continues as anonymous, and
 * `requireAuth` is what decides whether that is acceptable -- so public routes
 * and protected routes can share one middleware and a handler cannot forget to
 * run it.
 */
export const attachSession: RequestHandler = async (req, _res, next) => {
  try {
    const session = await resolveSession(req.cookies?.[sessionCookieName] as string | undefined);
    if (session) {
      req.session = session;
      req.user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        avatarUrl: session.user.avatarUrl,
        departmentId: session.user.departmentId,
      };
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Requires a valid session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
};

/**
 * Double-submit CSRF check.
 *
 * The session cookie is sent automatically by the browser on a cross-site
 * request, so cookie auth alone is not enough. The frontend must echo the
 * readable `ncr_csrf` cookie back in a header, and a cross-site attacker cannot
 * read a cookie to set a matching header.
 *
 * Only state-changing methods are checked. `GET`, `HEAD` and `OPTIONS` are
 * required to be safe, and requiring a token on them would break the browser's
 * preflight.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // No session means no cookie was sent, so there is nothing to protect against:
  // a request without the session cookie cannot act as the signed-in user.
  if (!req.session) {
    next();
    return;
  }

  const header = req.get(csrfHeaderName);
  if (!header) {
    next(
      forbidden(
        `Missing ${csrfHeaderName} header. The session cookie is sent automatically, so a state-changing request must prove it was not cross-site.`,
      ),
    );
    return;
  }

  if (!csrfSecretsMatch(req.session.csrfSecret, header)) {
    next(forbidden('CSRF token mismatch.'));
    return;
  }

  next();
};

/**
 * Requires one of `roles`.
 *
 * Authorisation, not authentication: the caller is signed in and still may not
 * do this. Kept separate from `requireAuth` so a role check is always written
 * next to the route it guards, where it can be reviewed.
 */
export function requireRole(...roles: AuthenticatedUser['role'][]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden(`This action requires the ${roles.join(' or ')} role.`));
      return;
    }
    next();
  };
}

/**
 * Slides the session expiry forward.
 *
 * Run after a successful authenticated request, not on every request: that would
 * be a database write per request to answer a question a daily job could answer.
 */
export const slideSession: RequestHandler = (req, _res, next) => {
  if (!req.session) {
    next();
    return;
  }
  void touchSession(req.session.id)
    .catch(() => {
      // A failed touch must not fail the request the user actually made; the
      // session still works until its original expiry.
    })
    .finally(() => next());
};

/** Wraps an async handler so a rejection reaches the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
