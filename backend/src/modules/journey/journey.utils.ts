import { createHash } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client";
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function nextDate(day: string, count: number): string {
  const date = new Date(day + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10);
}
