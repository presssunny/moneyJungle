/**
 * Document Preview (roadmap 2.3): "what did the system recognize from this
 * file" must be answerable from the Document history, not only during the
 * live import session. Runs the real import pipeline against a real credit
 * statement fixture, not hand-seeded rows. Skips when the fixture or the
 * database is unavailable.
 */
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { hasFixture } from "../../testing/fixtures";
import { creditService } from "../credit/credit.service";
import { importSessions } from "../imports/importSession.service";
import { documentsService } from "./documents.service";

const TEST_USER_PREFIX = "__test_docpreview_";
let dbUp = false;
let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;

async function dropTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: TEST_USER_PREFIX } } });
}

beforeAll(async () => {
  try {
    await prisma.user.findFirst();
    dbUp = true;
  } catch {
    dbUp = false;
  }
  if (dbUp) await dropTestUsers();
  storage = await mkdtemp(path.join(os.tmpdir(), "mj-docpreview-"));
  env.DOCUMENT_STORAGE_DIR = storage;
}, 30000);

afterAll(async () => {
  env.DOCUMENT_STORAGE_DIR = originalStorage;
  await rm(storage, { recursive: true, force: true });
  if (dbUp) await dropTestUsers();
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!hasFixture("creditStatement"))("מה זוהה מהקובץ, לפי המסמך בהיסטוריה", () => {
  it("שורות המסמך תואמות בדיוק את מה שסימן תהליך הקליטה האמיתי", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}real`, email: `${crypto.randomUUID()}@example.test` } });
    const card = await prisma.creditCard.create({ data: { userId: user.id, name: "test", issuer: "test", lastFour: "1234" } });
    const buffer = await readFile(path.join(process.cwd(), "tests/fixtures/credit-statement.xlsx"));

    const session = await importSessions.create(user.id, "credit-statement.xlsx", buffer, { kind: "credit", cardId: card.id });
    const committed = await importSessions.commit(user.id, session.id, session.version);
    const { documentId, creditImportId } = committed.result as { documentId: number; creditImportId: number };
    await creditService.confirmImport(user.id, creditImportId);

    const rows = await documentsService.rows(user.id, documentId);
    expect(rows.available).toBe(true);
    expect(rows.total).toBeGreaterThan(0);
    expect(rows.rows.length).toBe(Math.min(rows.total, rows.pageSize));

    // Every returned row is exactly what a real credit transaction ended up as.
    const transactions = await prisma.creditTransaction.findMany({ where: { userId: user.id, creditImportId } });
    for (const row of rows.rows) {
      expect(row.resolution).toBe("include");
      expect(row.resolutionLabel).toBe("נקלט");
      const match = transactions.find(
        (t) => t.businessName === row.name && Math.round(Number(t.amount) * 100) === Math.round(row.amount * 100)
      );
      expect(match, `no transaction matched row ${JSON.stringify(row)}`).toBeTruthy();
    }

    // Isolation: another user cannot read this document's recognized rows.
    const other = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}other`, email: `${crypto.randomUUID()}@example.test` } });
    await expect(documentsService.rows(other.id, documentId)).rejects.toThrow();
  });

  it("עמוד שני מחזיר שורות שונות מעמוד ראשון כשיש יותר מדף אחד", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}paged`, email: `${crypto.randomUUID()}@example.test` } });
    const card = await prisma.creditCard.create({ data: { userId: user.id, name: "test", issuer: "test", lastFour: "1234" } });
    const buffer = await readFile(path.join(process.cwd(), "tests/fixtures/credit-statement.xlsx"));
    const session = await importSessions.create(user.id, "credit-statement.xlsx", buffer, { kind: "credit", cardId: card.id });
    const committed = await importSessions.commit(user.id, session.id, session.version);
    const { documentId } = committed.result as { documentId: number };

    const first = await documentsService.rows(user.id, documentId, 1);
    if (first.total <= first.pageSize) return; // Fixture too small for a real page 2 — nothing to prove here.
    const second = await documentsService.rows(user.id, documentId, 2);
    const firstNumbers = new Set(first.rows.map((r) => r.rowNumber));
    expect(second.rows.every((r) => !firstNumbers.has(r.rowNumber))).toBe(true);
  });
});

describe("מה זוהה מהקובץ — מסמך ללא קליטה מתועדת", () => {
  it("מדווח שאין פירוט זמין, ולא מנחש שורות", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}legacy`, email: `${crypto.randomUUID()}@example.test` } });
    const documentId = await documentsService.record(user.id, {
      fileName: "legacy.xlsx",
      fileHash: "no-matching-session-hash",
      sizeBytes: 10,
      kind: "expense_sheet",
    });

    const rows = await documentsService.rows(user.id, documentId!);
    expect(rows).toEqual({ available: false, total: 0, page: 1, pageSize: rows.pageSize, rows: [] });
  });

  it("מסמך שלא קיים מחזיר שגיאה, לא רשימה ריקה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}missing`, email: `${crypto.randomUUID()}@example.test` } });
    await expect(documentsService.rows(user.id, 999999999)).rejects.toThrow();
  });
});
