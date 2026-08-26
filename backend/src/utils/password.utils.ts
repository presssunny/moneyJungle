import crypto from "crypto";

/**
 * Real per-account password hashing for the multi-user model — replaces the
 * single shared env password that credentials.ts used to compare directly.
 * Built on Node's built-in `crypto.scrypt` (salted, CPU/memory-hard) so no new
 * dependency (bcrypt/argon2) was needed — the codebase already reaches for
 * `crypto` in this exact spot (see the old credentials.ts `safeEqual`).
 *
 * Stored format: "<saltHex>:<hashHex>" — self-contained, no separate salt
 * column needed.
 */

const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain, salt);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * `false` for a malformed/missing stored hash (e.g. an account that was
 * backfilled without credentials yet) — never throws, so a login attempt
 * against such an account fails the same way a wrong password would.
 */
export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(plain, salt);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
