import crypto from "node:crypto";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";

const VERSION = "v1";

function key(): Buffer {
  const raw = env.BANK_CREDENTIALS_KEY ? Buffer.from(env.BANK_CREDENTIALS_KEY, "base64") : null;
  if (!raw || raw.length !== 32) {
    throw ApiError.internal("חסר מפתח הצפנה לפרטי ההתחברות (BANK_CREDENTIALS_KEY בקובץ backend/.env). לא נשמר דבר.");
  }
  return raw;
}

// The owner id is authenticated data: a blob copied onto another user's row fails to open.
export function sealCredentials(userId: number, credentials: Record<string, string>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`user:${userId}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function openCredentials(userId: number, sealed: string): Record<string, string> {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw ApiError.badRequest("פרטי ההתחברות השמורים פגומים. יש להזין אותם מחדש.");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(`user:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const text = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    throw ApiError.badRequest("לא ניתן לפענח את פרטי ההתחברות — ייתכן שמפתח ההצפנה הוחלף. יש להזין אותם מחדש.");
  }
}
