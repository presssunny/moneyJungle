import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { importRows } from "../imports/importRows.service";
import { creditService } from "./credit.service";

let userId: number;
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
/** One Cal statement holding a single installment row of the same 12-payment purchase. */
function statement(installment: number, charge: Date) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["פירוט עסקאות לדוגמה"],
    ["תאריך\nעסקה", "שם בית עסק", "סכום\nבש\"ח", "מועד\nחיוב", "סוג\nעסקה", "הערות"],
    [local(2026, 3, 20), "רהיטי הבית", 500, charge, "תשלומים", `תשלום ${installment} מתוך 12`],
  ], { cellDates: true });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "פירוט");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer;
}

beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__installments", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("installments across consecutive statements", () => {
  it("keeps payment 4 of 12 after payment 3 of 12 was imported, and still skips a true re-upload", async () => {
    await creditService.createImport(userId, "june.xlsx", statement(3, local(2026, 6, 10)));
    const july = await creditService.createImport(userId, "july.xlsx", statement(4, local(2026, 7, 10)));
    expect(july.alreadyImported).toBeFalsy();
    const again = await creditService.createImport(userId, "july-copy.xlsx", statement(4, local(2026, 7, 10)));
    expect(again.alreadyImported).toBe(true);
    const rows = await prisma.creditTransaction.findMany({ where: { userId }, orderBy: { installmentNumber: "asc" } });
    expect(rows.map((r) => r.installmentNumber)).toEqual([3, 4]);
  });

  it("does not offer payment 4 of 12 as a duplicate of payment 3 in the review step", async () => {
    await creditService.createImport(userId, "june.xlsx", statement(3, local(2026, 6, 10)));
    const session = await prisma.importSession.create({ data: { userId, fileName: "july.xlsx", fileHash: crypto.randomUUID().replace(/-/g, ""), kind: "credit", status: "processing", storagePath: "unused" } });
    const row = { date: "2026-03-20", name: "רהיטי הבית", amount: 500 };
    await importRows.replace(userId, session.id, "credit", {}, [{ ...row, installment: 4 }, { ...row, installment: 3 }]);
    const staged = await prisma.importRow.findMany({ where: { sessionId: session.id }, orderBy: { rowNumber: "asc" } });
    expect(staged.map((r) => r.resolution)).toEqual(["include", "review"]);
  });
});
