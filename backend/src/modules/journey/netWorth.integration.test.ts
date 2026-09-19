import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { financialMetric } from "./metrics.service";
import { loansService } from "../loans/loans.service";
import { fingerprint } from "./journey.utils";

let userId: number;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: "__networth", email: `${crypto.randomUUID()}@example.test` } })).id;

  await prisma.asset.createMany({
    data: [
      { userId, name: "קרן השתלמות", assetType: "pension", currentValue: 30000, asOfDate: new Date("2026-09-01") },
      { userId, name: "תיק השקעות", assetType: "investment", currentValue: 20000, asOfDate: new Date("2026-09-01") },
    ],
  });

  await prisma.loan.create({
    data: { userId, loanName: "משכנתא", loanType: "mortgage", originalAmount: 500000, currentBalance: 20000, annualInterestRate: 3, monthlyPayment: 2000, startDate: new Date("2020-01-01"), status: "active" },
  });

  // A bank balance and a savings goal exist too, deliberately not counted as
  // assets — that money may already be inside the bank balance (see AccountsPage).
  await prisma.bankAccount.create({ data: { userId, accountName: "עו״ש", bankName: "test", initialBalance: 0, currentBalance: 10000, anchorBalance: 10000, anchorDate: new Date("2026-09-01") } });
  await prisma.savingsGoal.create({ data: { userId, goalName: "חופשה", targetAmount: 5000, currentAmount: 5000 } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

async function creditBill(cardLastFour: string, chargeDate: string, amount: number, transactionType = "regular") {
  const card = await prisma.creditCard.create({ data: { userId, name: `card-${cardLastFour}`, issuer: "test", lastFour: cardLastFour } });
  const batch = await prisma.creditImport.create({ data: { userId, fileName: `${cardLastFour}.xlsx`, importMonth: 8, importYear: 2026, status: "confirmed" } });
  await prisma.creditTransaction.create({
    data: { userId, cardId: card.id, creditImportId: batch.id, amount, businessName: "test purchase", transactionType,
      billingDate: new Date("2026-08-01"), transactionDate: new Date("2026-08-01"), chargeDate: new Date(chargeDate) },
  });
  const key = `credit:${card.id}:${chargeDate}`;
  const snapshot = { key, date: chargeDate, name: `card-${cardLastFour}`, amount, kind: "credit", to: "/accounts?tab=credit" };
  return { cardId: card.id, key, fingerprint: fingerprint(snapshot) };
}

describe("net worth stays evidence-based, never a silent guess (Net Worth milestone)", () => {
  it("stays unavailable while a historical card bill has no decision -- undecided is not zero debt", async () => {
    const bill = await creditBill("1111", "2026-08-05", 1000);
    const metric = await financialMetric(userId, "netWorth", "2026-09");
    expect(metric.state).toBe("unavailable");
    expect(metric.value).toBeNull();
    expect(metric.missingData.some((m) => m.includes("חיובי אשראי"))).toBe(true);

    // Deciding the bill unblocks the figure.
    await prisma.commitmentDecision.create({ data: { userId, eventKey: bill.key, fingerprint: bill.fingerprint, decision: "unpaid", note: "טרם שולם" } });
  });

  it("computes assets minus active loan principal minus unpaid card debt -- ignoring bank balance, savings goals and financing rows", async () => {
    const loanSummary = (await loansService.list(userId)).summary;
    const metric = await financialMetric(userId, "netWorth", "2026-09");
    expect(metric.state).toBe("provisional");
    // 50,000 assets - 20,000 loan principal - 1,000 unpaid card bill.
    expect(metric.value).toBe(50000 - loanSummary.totalBalance - 1000);

    const loanComponent = metric.components.find((c) => c.key === "loans");
    expect(loanComponent?.value).toBe(-loanSummary.totalBalance);

    // A financing (revolving-credit) row is excluded from the bill set entirely,
    // so it never enters the liabilities figure -- it is out of scope for v1
    // (documented in metric.assumptions), not silently subtracted twice.
    await creditBill("2222", "2026-08-06", 99999, "financing");
    const after = await financialMetric(userId, "netWorth", "2026-09");
    expect(after.state).toBe("provisional");
    expect(after.value).toBe(metric.value);
  });
});
