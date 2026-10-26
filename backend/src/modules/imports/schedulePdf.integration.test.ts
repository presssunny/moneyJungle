import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A bank's amortisation table saved as PDF: its text, as pdf-parse reads it.
const SCHEDULE_TEXT = [
  "לוח סילוקין הלוואה 108",
  "מספר תשלום קרן תאריך סכום תשלום קרן ריבית יתרה לאחר תשלום קרן",
  "1 15/11/2026 1,000.00 120.00 49,000.00",
  "2 15/12/2026 1,004.00 116.00 47,996.00",
  "3 15/01/2027 1,008.00 112.00 46,988.00",
].join("\n");
vi.mock("pdf-parse/lib/pdf-parse.js", () => ({ default: vi.fn(async () => ({ text: SCHEDULE_TEXT, numpages: 1 })) }));

import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { importSessions } from "./importSession.service";

let userId: number;
let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;
beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-schedule-pdf-")); env.DOCUMENT_STORAGE_DIR = storage; });
beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__schedule_pdf_test", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

describe("a loan schedule saved as PDF", () => {
  it("is stopped with a clear message, even when 'bank statement' was chosen, and writes no rows", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "עו״ש" } });
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(64)]);
    const session = await importSessions.create(userId, "schedule.pdf", pdf, { kind: "bank", accountId: account.id });
    expect(session.status).toBe("failed");
    expect(JSON.stringify(session.preview)).toContain("לוח סילוקין נקלט כרגע רק מקובץ Excel");
    expect(await prisma.importRow.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(0);
  });
});
