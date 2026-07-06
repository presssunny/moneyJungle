import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { ParsedCreditRow, parseCreditFile } from "./creditParser.service";

/** Pick the most frequent transaction month as the import month. */
function inferImportMonth(rows: ParsedCreditRow[]): { month: number; year: number } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.transactionDate.getUTCFullYear()}-${row.transactionDate.getUTCMonth() + 1}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [year, month] = best[0].split("-").map(Number);
  return { year, month };
}

/** Match business names against category rules (user rules win over defaults). */
async function buildCategorizer(userId: number) {
  const rules = await prisma.categoryRule.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { userId: "desc" }, // user rules first (nulls last)
  });
  const normalized = rules.map((rule) => ({
    keyword: rule.keyword.toLowerCase(),
    categoryId: rule.categoryId,
  }));
  return (businessName: string): number | null => {
    const name = businessName.toLowerCase();
    const match = normalized.find((rule) => name.includes(rule.keyword));
    return match?.categoryId ?? null;
  };
}

export const creditService = {
  async listImports(userId: number) {
    const imports = await prisma.creditImport.findMany({
      where: { userId },
      orderBy: [{ importYear: "desc" }, { importMonth: "desc" }, { id: "desc" }],
    });
    return imports.map((imp) => ({ ...imp, totalAmount: decimalToNumber(imp.totalAmount) }));
  },

  async getImport(userId: number, id: number) {
    const creditImport = await prisma.creditImport.findFirst({
      where: { id, userId },
      include: {
        transactions: {
          include: { category: true },
          orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!creditImport) throw ApiError.notFound("הייבוא לא נמצא");
    return {
      ...creditImport,
      totalAmount: decimalToNumber(creditImport.totalAmount),
      transactions: creditImport.transactions.map((tx) => ({
        ...tx,
        amount: decimalToNumber(tx.amount),
      })),
    };
  },

  async createImport(
    userId: number,
    fileName: string,
    buffer: Buffer,
    override?: { importMonth?: number; importYear?: number }
  ) {
    const rows = parseCreditFile(buffer);
    const inferred = inferImportMonth(rows);
    const importMonth = override?.importMonth ?? inferred.month;
    const importYear = override?.importYear ?? inferred.year;
    const categorize = await buildCategorizer(userId);
    const totalAmount = round2(rows.reduce((sum, row) => sum + row.amount, 0));

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
        },
      });
      await tx.creditTransaction.createMany({
        data: rows.map((row) => ({
          creditImportId: creditImport.id,
          userId,
          transactionDate: row.transactionDate,
          businessName: row.businessName,
          amount: row.amount,
          categoryId: categorize(row.businessName),
          paymentCount: row.paymentCount,
          rawData: row.raw as Prisma.InputJsonValue,
        })),
      });
      return creditImport;
    });
    return this.getImport(userId, created.id);
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
