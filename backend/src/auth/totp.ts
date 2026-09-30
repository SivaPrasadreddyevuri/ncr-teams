/**
 * TOTP, RFC 6238.
 *
 * Implemented on `node:crypto` rather than pulled in as a dependency: it is an
 * HMAC over a counter, and a dependency here would mean trusting a package to
 * hold the one secret that can produce a valid code for a 30-second window.
 *
 * The whole flow is a shared secret, an HMAC key derived from it, and a
 * truncated 6-digit code compared in constant time.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
/** RFC 6238 recommends 30 seconds. Google Authenticator's default. */
export const PERIOD_SECONDS = 30;
/** One step either side absorbs clock drift between server and authenticator. */
const WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * Base32, per RFC 4648.
 *
 * Written out rather than pulled in because the alphabet and its bit order are
 * the interoperability contract with every authenticator app, and a subtly
 * different implementation produces codes that simply never validate -- with
 * no error to explain it.
 */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The counter for a moment in time: steps since the Unix epoch. */
function counterFor(timeStep: number): Buffer {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  return counter;
}

function codeFor(secret: Buffer, timeStep: number): string {
  const digest = createHmac('sha1', secret).update(counterFor(timeStep)).digest();

  // Dynamic truncation: the low nibble of the last byte selects the 4 bytes to
  // read, and the top bit of that byte is masked off. This is specified, not
  // arbitrary.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The current code. Used by tests and by the setup flow. */
export function currentCode(secret: string, now = new Date()): string {
  return codeFor(base32Decode(secret), Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));
}

/**
 * Verifies a submitted code.
 *
 * Checks `WINDOW` steps either side of now, so a phone whose clock has drifted
 * by a few seconds still works. Every candidate is compared with
 * `timingSafeEqual`, and the loop does not exit early, so the response time does
 * not reveal which step matched.
 */
export function verifyCode(secret: string, code: string, now = new Date()): boolean {
  const normalised = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalised)) return false;

  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const nowStep = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
  const expected = Buffer.from(normalised, 'utf8');

  let matched = false;
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const candidate = Buffer.from(codeFor(secretBytes, nowStep + offset), 'utf8');
    // Accumulate rather than return: an early return would make the timing
    // depend on which step matched.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      matched = true;
    }
  }
  return matched;
}

/** `otpauth://` URI, for a QR code. */
export function provisioningUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
