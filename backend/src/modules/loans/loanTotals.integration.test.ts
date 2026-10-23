import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { dashboardService } from "../dashboard/dashboard.service";
import { loansService } from "./loans.service";

let userId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__loan_totals_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  const base = { userId, loanType: "bank", monthlyPayment: 0, startDate: new Date("2026-01-01"), status: "active" as const };
  await prisma.loan.createMany({
    data: [
      { ...base, loanName: "108/432", loanNumber: "108", trackNumber: "432", originalAmount: 90000, currentBalance: 42000, annualInterestRate: 9.4, monthlyPayment: 1886 },
      { ...base, loanName: "108/562", loanNumber: "108", trackNumber: "562", originalAmount: null, currentBalance: null, annualInterestRate: null, originalAmountSource: "unknown", monthlyPayment: 900, scheduleSource: "statement" },
      { ...base, loanName: "from family", loanType: "private", originalAmount: 12000, currentBalance: 10000, annualInterestRate: 0, monthlyPayment: 500 },
    ],
  });
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("one loan sum for the loans screen, its groups and the dashboard", () => {
  it("gives the same known balance and monthly payment everywhere, and counts the unknown instead of adding 0", async () => {
    const { summary, totals, groups, loans } = await loansService.list(userId);
    const dashboard = (await dashboardService.summary(userId, 2026, 9)).loans;

    expect(summary).toMatchObject({ totalBalance: 52000, monthlyPayment: 3286, unknownBalanceCount: 1, unknownInterestCount: 1 });
    expect(totals).toMatchObject({ totalBalance: 52000, monthlyPayment: 3286, unknownBalanceCount: 1, unknownInterestCount: 1 });
    expect(dashboard).toMatchObject({
      totalBalance: summary.totalBalance, monthlyPayment: summary.monthlyPayment,
      monthlyInterest: summary.monthlyInterest, annualInterest: summary.annualInterest,
      unknownBalanceCount: 1, unknownInterestCount: 1, count: 3,
    });
    expect(groups).toEqual([expect.objectContaining({ loanNumber: "108", totalBalance: 42000, unknownBalanceCount: 1 })]);

    // A 0% loan is a known 0, not an unknown one.
    const family = loans.find((l) => l.loanName === "from family");
    expect(family?.annualInterestRate).toBe(0);
    expect(family?.computed?.monthlyInterestPayment).toBe(0);
    expect(loans.find((l) => l.loanName === "108/562")?.computed).toBeNull();
  });

  it("splits interest from principal only where both balance and rate are known", async () => {
    const { loanSplit } = await dashboardService.charts(userId, 2026, 9);
    expect(loanSplit.map((s) => s.name).sort()).toEqual(["108/432", "from family"]);
    expect(loanSplit.find((s) => s.name === "from family")).toMatchObject({ interest: 0, principal: 500 });
  });
});
