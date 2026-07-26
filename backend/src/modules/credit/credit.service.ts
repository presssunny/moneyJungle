import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { buildRuleCategorizer } from "../categories/categorization.service";
import { hashFile } from "../imports/statementDetector.service";
import { ParsedCreditRow, parseCreditFile } from "./creditParser.service";

/**
 * The date an expense is attributed to = when the purchase was actually made
 * (transaction date). A buy on 20/06 is a June expense even if the card only
 * charges it on 15/07. The charge date is still stored separately (chargeDate)
 * so "when it hits the account" isn't lost.
 */
function attributionDateOf(row: ParsedCreditRow): Date {
  return row.transactionDate;
}

/** Label the import by the billing month that holds the most real-spend transactions. */
function inferImportMonth(rows: ParsedCreditRow[]): { month: number; year: number } {
  const counts = new Map<string, number>();
  const spendRows = rows.filter((r) => r.transactionType !== "financing");
  for (const row of spendRows.length > 0 ? spendRows : rows) {
    const d = attributionDateOf(row);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [year, month] = best[0].split("-").map(Number);
  return { year, month };
}

/** Group real-spend transactions by billing month → { "YYYY-MM": {count, total} }. */
function monthlyBreakdown(
  transactions: Array<{ billingDate: Date; amount: number; transactionType: string }>
): Array<{ monthKey: string; count: number; total: number }> {
  const map = new Map<string, { count: number; total: number }>();
  for (const tx of transactions) {
    if (tx.transactionType === "financing") continue; // exclude revolving-credit movements
    const key = `${tx.billingDate.getUTCFullYear()}-${String(tx.billingDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = map.get(key) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += tx.amount;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([monthKey, v]) => ({ monthKey, count: v.count, total: round2(v.total) }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

export const creditService = {
  async listImports(userId: number) {
    const imports = await prisma.creditImport.findMany({
      where: { userId },
      orderBy: [{ importYear: "desc" }, { importMonth: "desc" }, { id: "desc" }],
    });
    // One cheap query gives the billing-month span + count per import
    const spans = await prisma.creditTransaction.groupBy({
      by: ["creditImportId"],
      where: { userId },
      _min: { billingDate: true },
      _max: { billingDate: true },
      _count: { _all: true },
    });
    const spanById = new Map(spans.map((s) => [s.creditImportId, s]));
    return imports.map((imp) => {
      const span = spanById.get(imp.id);
      return {
        ...imp,
        totalAmount: decimalToNumber(imp.totalAmount),
        firstBillingDate: span?._min.billingDate ?? null,
        lastBillingDate: span?._max.billingDate ?? null,
      };
    });
  },

  async getImport(userId: number, id: number) {
    const creditImport = await prisma.creditImport.findFirst({
      where: { id, userId },
      include: {
        transactions: {
          include: { category: true },
          orderBy: [{ billingDate: "desc" }, { transactionDate: "desc" }, { id: "desc" }],
        },
      },
    });
    if (!creditImport) throw ApiError.notFound("הייבוא לא נמצא");
    const transactions = creditImport.transactions.map((tx) => ({
      ...tx,
      amount: decimalToNumber(tx.amount),
    }));
    return {
      ...creditImport,
      totalAmount: decimalToNumber(creditImport.totalAmount),
      transactions,
      // Per-month breakdown so a multi-month statement reads as multiple months
      monthlyBreakdown: monthlyBreakdown(transactions),
    };
  },

  async createImport(
    userId: number,
    fileName: string,
    buffer: Buffer,
    override?: { importMonth?: number; importYear?: number }
  ) {
    const parsedRows = parseCreditFile(buffer);
    const fileHash = hashFile(buffer);

    // Same bytes, any file name: this exact statement was already taken in.
    const sameFile = await prisma.creditImport.findFirst({
      where: { userId, fileHash },
      select: { id: true, fileName: true, createdAt: true, totalTransactions: true, status: true },
    });

    // Keep only transactions not already stored, so re-uploading a statement
    // that overlaps last month's adds the new days and nothing else. Matching
    // is on the statement's own identifying fields — a card re-issues the same
    // business/amount pair often, so the date must take part.
    const existing = await prisma.creditTransaction.findMany({
      where: { userId },
      select: { transactionDate: true, businessName: true, amount: true, paymentCount: true },
    });
    const keyOf = (date: Date, business: string, amount: number, payments: number) =>
      `${date.toISOString().slice(0, 10)}|${business.trim()}|${round2(amount)}|${payments}`;
    const seen = new Set(
      existing.map((t) => keyOf(t.transactionDate, t.businessName, Number(t.amount), t.paymentCount))
    );
    const rows = parsedRows.filter((row) => {
      const key = keyOf(row.transactionDate, row.businessName, row.amount, row.paymentCount);
      if (seen.has(key)) return false;
      seen.add(key); // also collapses repeats inside the same file
      return true;
    });
    const skippedDuplicates = parsedRows.length - rows.length;

    // Nothing new at all — report it instead of creating an empty import that
    // the user would have to find and delete.
    if (rows.length === 0) {
      return {
        alreadyImported: true,
        skippedDuplicates,
        parsedRows: parsedRows.length,
        previousImport: sameFile
          ? { id: sameFile.id, fileName: sameFile.fileName, createdAt: sameFile.createdAt }
          : null,
      } as const;
    }

    const inferred = inferImportMonth(rows);
    // Label uses the newest billing month; each transaction is still attributed
    // to its own billing month everywhere else, so a multi-month file is not
    // collapsed into one month.
    const importMonth = override?.importMonth ?? inferred.month;
    const importYear = override?.importYear ?? inferred.year;
    const categorize = await buildRuleCategorizer(userId);
    // The displayed statement total is real spend — revolving-credit financing excluded
    const totalAmount = round2(
      rows.filter((row) => row.transactionType !== "financing").reduce((sum, row) => sum + row.amount, 0)
    );


    const created = await prisma.$transaction(async (tx) => {
      const creditImport = await tx.creditImport.create({
        data: {
          userId,
          fileName,
          importMonth,
          importYear,
          totalTransactions: rows.length,
          totalAmount,
          status: "pending",
          fileHash,
        },
      });
      await tx.creditTransaction.createMany({
        data: rows.map((row) => ({
          creditImportId: creditImport.id,
          userId,
          transactionDate: row.transactionDate,
          chargeDate: row.chargeDate,
          billingDate: attributionDateOf(row),
          businessName: row.businessName,
          amount: row.amount,
          categoryId: categorize(row.businessName),
          paymentCount: row.paymentCount,
          transactionType: row.transactionType,
          rawData: row.raw as Prisma.InputJsonValue,
        })),
      });
      return creditImport;
    });
    const detail = await this.getImport(userId, created.id);
    return {
      ...detail,
      alreadyImported: false as const,
      /** Rows this file shared with data already stored — taken in only once. */
      skippedDuplicates,
      parsedRows: parsedRows.length,
      previousImport: sameFile
        ? { id: sameFile.id, fileName: sameFile.fileName, createdAt: sameFile.createdAt }
        : null,
    };
  },

  async confirmImport(userId: number, id: number) {
    const creditImport = await prisma.creditImport.findFirst({ where: { id, userId } });
    if (!creditImport) throw ApiError.notFound("הייבוא לא נמצא");
    if (creditImport.status === "confirmed") {
      throw ApiError.badRequest("הייבוא כבר אושר");
    }
    await prisma.creditImport.update({ where: { id }, data: { status: "confirmed" } });
    return this.getImport(userId, id);
  },

  async removeImport(userId: number, id: number) {
    const creditImport = await prisma.creditImport.findFirst({ where: { id, userId } });
    if (!creditImport) throw ApiError.notFound("הייבוא לא נמצא");
    await prisma.creditImport.delete({ where: { id } }); // cascades to transactions
  },

  /**
   * Re-run category rules over the user's still-uncategorized credit transactions.
   * Useful after adding new rules — assigns categories without touching manual ones.
   */
  async recategorize(userId: number) {
    const categorize = await buildRuleCategorizer(userId);
    const pending = await prisma.creditTransaction.findMany({
      where: { userId, categoryId: null, transactionType: { not: "financing" } },
      select: { id: true, businessName: true },
    });
    let updated = 0;
    for (const tx of pending) {
      const categoryId = categorize(tx.businessName);
      if (categoryId !== null) {
        await prisma.creditTransaction.update({ where: { id: tx.id }, data: { categoryId } });
        updated += 1;
      }
    }
    return { scanned: pending.length, categorized: updated };
  },

  async updateTransaction(userId: number, id: number, categoryId: number | null) {
    const transaction = await prisma.creditTransaction.findFirst({ where: { id, userId } });
    if (!transaction) throw ApiError.notFound("העסקה לא נמצאה");
    if (categoryId !== null) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      });
      if (!category) throw ApiError.badRequest("הקטגוריה לא נמצאה");
    }
    const updated = await prisma.creditTransaction.update({
      where: { id },
      data: { categoryId },
      include: { category: true },
    });
    return { ...updated, amount: decimalToNumber(updated.amount) };
  },
};
