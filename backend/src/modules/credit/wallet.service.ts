import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import type { WalletTransaction } from "../../types/planning.types";

export function summarizeWallet(rows: WalletTransaction[], monthKey: string, previousKey: string, today: string) {
  const spend = rows.filter((row) => row.transactionType !== "financing");
  const transactions = spend.filter((row) => row.billingDate.startsWith(monthKey));
  const previous = spend.filter((row) => row.billingDate.startsWith(previousKey));
  const sum = (items: WalletTransaction[]) => round2(items.reduce((total, row) => total + row.amount, 0));
  const nextDate = spend.map((row) => row.chargeDate).filter((date): date is string => date !== null && date >= today).sort()[0] ?? null;
  const categories = new Map<string, number>();
  for (const row of transactions) categories.set(row.categoryName, (categories.get(row.categoryName) ?? 0) + row.amount);
  return {
    total: sum(transactions),
    previousTotal: previous.length ? sum(previous) : null,
    delta: previous.length && transactions.length ? round2(sum(transactions) - sum(previous)) : null,
    nextCharge: nextDate ? { date: nextDate, amount: sum(spend.filter((row) => row.chargeDate === nextDate)) } : null,
    categories: [...categories].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    transactions,
    financingTotal: sum(rows.filter((row) => row.billingDate.startsWith(monthKey) && row.transactionType === "financing")),
  };
}

export const walletService = {
  cards(userId: number) {
    return prisma.creditCard.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },
  async list(userId: number, year: number, month: number) {
    const { start } = monthRange(year, month);
    const previous = new Date(Date.UTC(year, month - 2, 1));
    const today = new Date().toISOString().slice(0, 10);
    const [cards, rows, pendingCount, lastImport] = await Promise.all([
      prisma.creditCard.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      prisma.creditTransaction.findMany({
        where: { userId, creditImport: { status: "confirmed" }, OR: [
          { billingDate: { gte: previous, lt: new Date(Date.UTC(year, month, 1)) } },
          { chargeDate: { gte: new Date(today) } },
        ] },
        include: { category: true }, orderBy: [{ billingDate: "desc" }, { id: "desc" }],
      }),
      prisma.creditTransaction.count({ where: { userId, creditImport: { status: "pending" } } }),
      prisma.creditImport.aggregate({ where: { userId, status: "confirmed" }, _max: { createdAt: true } }),
    ]);
    const transactions: WalletTransaction[] = rows.map((row) => ({
      id: row.id, cardId: row.cardId, amount: decimalToNumber(row.amount), businessName: row.businessName,
      billingDate: row.billingDate.toISOString().slice(0, 10), transactionDate: row.transactionDate.toISOString().slice(0, 10),
      chargeDate: row.chargeDate?.toISOString().slice(0, 10) ?? null, categoryName: row.category?.name ?? "לא מסווג",
      transactionType: row.transactionType, paymentCount: row.paymentCount,
    }));
    const summary = (items: WalletTransaction[]) => summarizeWallet(items, start.toISOString().slice(0, 7), previous.toISOString().slice(0, 7), today);
    return { updatedAt: new Date().toISOString(), lastConfirmedImportAt: lastImport._max.createdAt?.toISOString() ?? null,
      pendingCount, cards: cards.map((card) => ({ ...card, ...summary(transactions.filter((row) => row.cardId === card.id)) })),
      all: summary(transactions), unassigned: summary(transactions.filter((row) => row.cardId === null)) };
  },
  create(userId: number, input: { name: string; issuer: string; lastFour: string; billingDay?: number | null }) {
    return prisma.creditCard.create({ data: { userId, ...input } });
  },
  async update(userId: number, id: number, input: { name: string; issuer: string; lastFour: string; billingDay?: number | null }) {
    const result = await prisma.creditCard.updateMany({ where: { id, userId }, data: input });
    if (!result.count) throw ApiError.notFound("הכרטיס לא נמצא");
    return { id };
  },
  async assign(userId: number, importId: number, cardId: number | null) {
    return prisma.$transaction(async (tx) => {
      if (!await tx.creditImport.findFirst({ where: { id: importId, userId } })) throw ApiError.notFound("הייבוא לא נמצא");
      if (cardId !== null && !await tx.creditCard.findFirst({ where: { id: cardId, userId } })) throw ApiError.notFound("הכרטיס לא נמצא");
      return tx.creditTransaction.updateMany({ where: { creditImportId: importId, userId }, data: { cardId } });
    });
  },
  async assignTransaction(userId: number, id: number, cardId: number | null) {
    if (cardId !== null && !await prisma.creditCard.findFirst({ where: { id: cardId, userId } })) throw ApiError.notFound("הכרטיס לא נמצא");
    const result = await prisma.creditTransaction.updateMany({ where: { id, userId }, data: { cardId } });
    if (!result.count) throw ApiError.notFound("העסקה לא נמצאה");
    return result;
  },
};
