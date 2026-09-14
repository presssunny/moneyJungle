import crypto from "crypto";

const KEY_LENGTH = 64;
const CURRENT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const LEGACY = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const PREFIX = "scrypt$131072$8$1$";
export const dummyPasswordHash = `${PREFIX}${"0".repeat(32)}$${"0".repeat(128)}`;

function derive(password: string, salt: Buffer, options: typeof CURRENT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, options, (err, key) => err ? reject(err) : resolve(key));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await derive(plain, salt, CURRENT);
  return `${PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function needsPasswordRehash(stored: string): boolean { return !stored.startsWith(PREFIX); }

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const modern = stored.startsWith(PREFIX);
  const parts = modern ? stored.slice(PREFIX.length).split("$") : stored.split(":");
  if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0]) || !/^[a-f0-9]{128}$/.test(parts[1])) return false;
  const actual = await derive(plain, Buffer.from(parts[0], "hex"), modern ? CURRENT : LEGACY);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[1], "hex"));
}
