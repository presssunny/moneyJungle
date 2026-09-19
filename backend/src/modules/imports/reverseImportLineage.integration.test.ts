import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma, withFinancialTransaction } from "../../config/database";
import { env } from "../../config/env";
import { importSessions } from "./importSession.service";
import { importRows } from "./importRows.service";
import { creditService } from "../credit/credit.service";

let userId: number; let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;
const sheet = (rows: unknown[][]) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Data"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer; };
const expenseFile = () => sheet([["שם", "סכום", "תאריך"], ["Traced coffee", 18, "17/09/2026"]]);

beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-lineage-")); env.DOCUMENT_STORAGE_DIR = storage; });
beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__lineage_test", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

// A record's importRowId should resolve, via a real indexed FK join (not a
// JSON scan), all the way back to the session/file that created it (P0.3 / G2).
async function traceExpense(expenseId: number) {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { importRow: { include: { session: true } } } });
  return expense.importRow?.session ?? null;
}

describe("reverse import lineage: financial record -> ImportRow -> ImportSession (P0.3 / G2)", () => {
  it("traces a newly imported expense back to its session and source file", async () => {
    const session = await importSessions.create(userId, "traced-expenses.xlsx", expenseFile(), { kind: "expense_sheet" });
    await importSessions.commit(userId, session.id, session.version);
    const expense = await prisma.expense.findFirstOrThrow({ where: { userId } });
    expect(expense.importRowId).not.toBeNull();
    const source = await traceExpense(expense.id);
    expect(source?.id).toBe(session.id);
    expect(source?.fileName).toBe("traced-expenses.xlsx");
  });

  it("traces a newly imported bank transaction back to its session and source file", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    const buffer = await readFile(path.join(process.cwd(), "tests/fixtures/bank-statement.xlsx"));
    const session = await importSessions.create(userId, "traced-statement.xlsx", buffer, { kind: "bank", accountId: account.id });
    await importSessions.commit(userId, session.id, session.version);
    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { userId, importRowId: { not: null } } });
    const importRow = await prisma.importRow.findUniqueOrThrow({ where: { id: row.importRowId! }, include: { session: true } });
    expect(importRow.session.id).toBe(session.id);
    expect(importRow.session.fileName).toBe("traced-statement.xlsx");
  });

  it("traces a newly imported credit transaction back to its session and source file", async () => {
    const card = await prisma.creditCard.create({ data: { userId, name: "test", issuer: "test", lastFour: "1234" } });
    const buffer = await readFile(path.join(process.cwd(), "tests/fixtures/credit-statement.xlsx"));
    const session = await importSessions.create(userId, "traced-credit.xlsx", buffer, { kind: "credit", cardId: card.id });
    const committed = await importSessions.commit(userId, session.id, session.version);
    await creditService.confirmImport(userId, (committed.result as { creditImportId: number }).creditImportId);
    const row = await prisma.creditTransaction.findFirstOrThrow({ where: { userId, importRowId: { not: null } } });
    const importRow = await prisma.importRow.findUniqueOrThrow({ where: { id: row.importRowId! }, include: { session: true } });
    expect(importRow.session.id).toBe(session.id);
    expect(importRow.session.fileName).toBe("traced-credit.xlsx");
  });

  it("a row resolved as a duplicate never reassigns lineage away from the pre-existing record's real origin", async () => {
    const existing = await prisma.expense.create({ data: { userId, businessName: "Traced coffee", amount: 18, expenseDate: new Date("2026-09-17") } });
    expect(existing.importRowId).toBeNull();
    const file = sheet([["שם", "סכום", "תאריך"], ["Traced coffee", 18, "17/09/2026"]]);
    const session = await importSessions.create(userId, "duplicate.xlsx", file, { kind: "expense_sheet" });
    await withFinancialTransaction(userId, () => importRows.edit(userId, session.id, 1, { version: session.version, resolution: "duplicate", candidateId: existing.id, candidateKind: "expense" }));
    const refreshed = await importSessions.get(userId, session.id);
    await importSessions.commit(userId, session.id, refreshed.version);
    const unchanged = await prisma.expense.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged.importRowId).toBeNull();
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
  });

  it("a retried commit does not create a second lineage link or a second record", async () => {
    const session = await importSessions.create(userId, "retry.xlsx", expenseFile(), { kind: "expense_sheet" });
    const [a, b] = await Promise.all([importSessions.commit(userId, session.id, session.version), importSessions.commit(userId, session.id, session.version)]);
    expect(a.id).toBe(b.id);
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
    const expense = await prisma.expense.findFirstOrThrow({ where: { userId } });
    expect(expense.importRowId).not.toBeNull();
    expect(await prisma.importRow.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it("a manually entered expense with no import has no lineage to trace", async () => {
    const manual = await prisma.expense.create({ data: { userId, businessName: "Manual", amount: 5, expenseDate: new Date("2026-09-17") } });
    expect(await traceExpense(manual.id)).toBeNull();
  });
});
