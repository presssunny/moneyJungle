import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";
import { parseBankStatement } from "./bankParser.service";
import {
  CreateBankAccountBody,
  CreateBankTransactionBody,
  UpdateBankAccountBody,
} from "./bank.validation";

/** Deposits raise the balance; every other transaction type lowers it. */
function signedAmount(type: string, amount: number): number {
  return type === "deposit" ? amount : -amount;
}

async function requireAccount(userId: number, id: number) {
  const account = await prisma.bankAccount.findFirst({ where: { id, userId } });
  if (!account) throw ApiError.notFound("חשבון הבנק לא נמצא");
  return account;
}

/** Match a description against category rules (user rules win over defaults). */
async function buildCategorizer(userId: number) {
  const rules = await prisma.categoryRule.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { userId: "desc" },
  });
  const normalized = rules.map((rule) => ({ keyword: rule.keyword.toLowerCase(), categoryId: rule.categoryId }));
  return (description: string): number | null => {
    const text = description.toLowerCase();
    return normalized.find((rule) => text.includes(rule.keyword))?.categoryId ?? null;
  };
}

export const bankService = {
  listAccounts(userId: number) {
    return prisma.bankAccount.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      include: { _count: { select: { transactions: true } } },
    });
  },

  createAccount(userId: number, body: CreateBankAccountBody) {
    return prisma.bankAccount.create({
      data: {
        userId,
        bankName: body.bankName,
        accountName: body.accountName,
        initialBalance: body.initialBalance,
        currentBalance: body.initialBalance,
      },
    });
  },

  async updateAccount(userId: number, id: number, body: UpdateBankAccountBody) {
    await requireAccount(userId, id);
    return prisma.bankAccount.update({ where: { id }, data: body });
  },

  async removeAccount(userId: number, id: number) {
    await requireAccount(userId, id);
    await prisma.bankAccount.delete({ where: { id } });
  },

  async listTransactions(userId: number, accountId: number) {
    await requireAccount(userId, accountId);
    return prisma.bankTransaction.findMany({
      where: { userId, bankAccountId: accountId },
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      include: { category: true },
    });
  },

  async createTransaction(userId: number, accountId: number, body: CreateBankTransactionBody) {
    await requireAccount(userId, accountId);
    const [transaction] = await prisma.$transaction([
      prisma.bankTransaction.create({
        data: {
          userId,
          bankAccountId: accountId,
          transactionDate: body.transactionDate,
          description: body.description ?? null,
          amount: body.amount,
          type: body.type,
          categoryId: body.categoryId ?? null,
        },
        include: { category: true },
      }),
      prisma.bankAccount.update({
        where: { id: accountId },
        data: { currentBalance: { increment: signedAmount(body.type, body.amount) } },
      }),
    ]);
    return transaction;
  },

  /**
   * Import a current-account (עו״ש) statement file into an account: money-in
   * rows become deposits, money-out rows become withdrawals. Withdrawals are
   * auto-categorized via category rules. Rows already present (same date +
   * amount + type + description) are skipped so re-uploading is safe. The
   * account balance is adjusted once by the net of everything imported.
   */
  async importStatement(userId: number, accountId: number, buffer: Buffer) {
    await requireAccount(userId, accountId);
    const rows = parseBankStatement(buffer);
    const categorize = await buildCategorizer(userId);

    // Build a dedup key set from existing transactions in the file's date range.
    const dates = rows.map((r) => r.date.getTime());
    const existing = await prisma.bankTransaction.findMany({
      where: {
        userId,
        bankAccountId: accountId,
        transactionDate: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) },
      },
      select: { transactionDate: true, amount: true, type: true, description: true },
    });
    const keyOf = (d: Date, amount: number, type: string, desc: string | null) =>
      `${d.toISOString().slice(0, 10)}|${round2(amount)}|${type}|${(desc ?? "").trim()}`;
    const seen = new Set(existing.map((t) => keyOf(t.transactionDate, Number(t.amount), t.type, t.description)));

    const fresh = rows.filter((r) => {
      const key = keyOf(r.date, r.amount, r.type, r.description);
      if (seen.has(key)) return false;
      seen.add(key); // also dedupes repeats within the same file
      return true;
    });

    let deposits = 0;
    let withdrawals = 0;
    let balanceDelta = 0;
    if (fresh.length > 0) {
      await prisma.$transaction([
        prisma.bankTransaction.createMany({
          data: fresh.map((r) => {
            balanceDelta += signedAmount(r.type, r.amount);
            if (r.type === "deposit") deposits += 1;
            else withdrawals += 1;
            return {
              userId,
              bankAccountId: accountId,
              transactionDate: r.date,
              description: r.description,
              amount: r.amount,
              type: r.type,
              categoryId: r.type === "withdrawal" ? categorize(r.description) : null,
            };
          }),
        }),
        prisma.bankAccount.update({
          where: { id: accountId },
          data: { currentBalance: { increment: round2(balanceDelta) } },
        }),
      ]);
    }

    return {
      parsed: rows.length,
      imported: fresh.length,
      skippedDuplicates: rows.length - fresh.length,
      deposits,
      withdrawals,
    };
  },

  async removeTransaction(userId: number, id: number) {
    const transaction = await prisma.bankTransaction.findFirst({ where: { id, userId } });
    if (!transaction) throw ApiError.notFound("התנועה לא נמצאה");
    await prisma.$transaction([
      prisma.bankTransaction.delete({ where: { id } }),
      prisma.bankAccount.update({
        where: { id: transaction.bankAccountId },
        data: { currentBalance: { decrement: signedAmount(transaction.type, Number(transaction.amount)) } },
      }),
    ]);
  },
};
