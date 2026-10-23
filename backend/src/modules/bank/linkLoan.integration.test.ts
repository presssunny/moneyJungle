import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { reconciliationService } from "./reconciliation.service";

let userId: number;
let accountId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__link_loan_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "עו״ש" } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

function bankRow(lineKind: string, amount: number, type: "withdrawal" | "deposit") {
  return prisma.bankTransaction.create({
    data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-08-15"), description: "הלוואה 108", amount, lineKind, type, loanRef: "108" },
  });
}

describe("linking bank rows to a new loan", () => {
  it("leaves what the rows cannot tell unknown (NULL), never 0", async () => {
    const row = await bankRow("loan_principal", 900, "withdrawal");
    const loan = await reconciliationService.linkLoan(userId, { transactionIds: [row.id] });
    expect(loan?.originalAmount).toBeNull();
    expect(loan?.currentBalance).toBeNull();
    expect(loan?.annualInterestRate).toBeNull();
    expect(loan?.originalAmountSource).toBe("unknown");
  });

  it("takes the opening amount and balance from a drawdown, which states them", async () => {
    const row = await bankRow("loan_drawdown", 50000, "deposit");
    const loan = await reconciliationService.linkLoan(userId, { transactionIds: [row.id] });
    expect(Number(loan?.originalAmount)).toBe(50000);
    expect(Number(loan?.currentBalance)).toBe(50000);
    expect(loan?.annualInterestRate).toBeNull();
    expect(loan?.originalAmountSource).not.toBe("unknown");
  });
});
