/**
 * Environment configuration.
 *
 * Validated once at import time. A missing or malformed variable throws here, at
 * boot, rather than surfacing as a confusing failure on the first request that
 * happens to touch it -- a service that starts with no session pepper and only
 * discovers it when someone logs in is worse than one that refuses to start.
 */

import { z } from 'zod';

/**
 * Defaults are only allowed where a default is genuinely safe. Nothing
 * security-relevant has one: the pepper has no default because a shared
 * hard-coded fallback would be a working key in every deployment that forgot
 * to set its own.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    /**
     * Pooled connection for request handling.
     *
     * On Neon this is the `-pooler` host with `?pgbouncer=true`. A pooler sits
     * between the app and Postgres and multiplexes many logical connections onto
     * one, which is what a serverless instance needs.
     */
    DATABASE_URL: z.string().url(),

    /**
     * Unpooled connection, used only by migrations and by tests that need to
     * prepare a schema. Migrations issue DDL and read session state, neither of
     * which survives a transaction pooler, so they must not share the pooled URL.
     */
    DIRECT_DATABASE_URL: z.string().url(),

    /**
     * HMAC key for session tokens.
     *
     * The database stores a keyed hash of each session token rather than the
     * token itself, so a database leak does not hand over live sessions. A
     * random 32-byte value; generate with:
     *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     */
    SESSION_PEPPER: z.string().min(32, 'SESSION_PEPPER must be at least 32 characters'),

    /** Session lifetime in seconds. Default 7 days. */
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(7 * 24 * 60 * 60),

    /**
     * Extra browser origins allowed to send credentialed requests.
     *
     * Unnecessary in production: the frontend proxies `/api/*` to this service
     * (see frontend/next.config.ts), so from the browser both origins are the
     * same and no cross-origin request is ever made. It exists for local
     * development, where the frontend runs on :3000 and this service on :4000.
     */
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    /**
     * Largest accepted upload.
     *
     * 5 MB, and the reason it is a cap rather than a design constraint is
     * `bytea`: the content lives in the File row, so an upload is bounded by what
     * a single row can hold and by the instance's memory. Buffering to the cap
     * and storing is therefore safe here -- the "never buffer a 50 MB body" rule
     * that applied to an on-disk writer was about a limit this cap never
     * approaches.
     *
     * The hosted free tier also has a storage allowance shared with everything
     * else, so the cap is the per-file bound and the tier's total is the real one.
     * Large Objects (`pg_largeobject`) are the step up if that needs raising.
     */
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),

    /**
     * Number of reverse proxies in front of this service. Render terminates TLS
     * and forwards one hop, so this is 1 in production.
     *
     * It matters: without it Express reads `X-Forwarded-For` as the client
     * address only if it trusts the proxy, and a wrong value here would make
     * every request look like it came from the proxy.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production' && value.TRUST_PROXY_HOPS === 0) return;

    // A production deploy behind no proxy would mean the public URL is plain
    // HTTP and the session cookie cannot be Secure, so it is worth failing on.
    if (value.NODE_ENV === 'production' && value.TRUST_PROXY_HOPS === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY_HOPS'],
        message:
          'TRUST_PROXY_HOPS must be at least 1 in production: the service is expected to sit behind a TLS-terminating proxy, and requests arriving over plain HTTP cannot set a Secure cookie.',
      });
    }
  });

function load(): z.infer<typeof schema> {
  const parsed = schema.safeParse(process.env);

  if (parsed.success) return parsed.data;

  // `dotenv/config` is imported for its side effect by the caller, so a missing
  // .env shows up here as a missing variable rather than a silent default.
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );

  throw new Error(
    `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
      'See backend/.env.example. Copy it to backend/.env and fill it in.',
  );
}

export const config = load();

export const isProduction = config.NODE_ENV === 'production';

/** Credentialed origins allowed in development. */
export const corsOrigins = config.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const sessionCookieName = 'ncr_session';
export const csrfCookieName = 'ncr_csrf';
export const csrfHeaderName = 'x-csrf-token';
