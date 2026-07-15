import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
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
