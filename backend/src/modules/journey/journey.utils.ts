import { createHash } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client";
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export { businessDate, nextDate } from "../../utils/date.utils";
