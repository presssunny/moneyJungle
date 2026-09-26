import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { buildInsights } from "../dashboard/insights.service";
import { dashboardService, monthTotals } from "../dashboard/dashboard.service";
import { reportsService } from "./reports.service";

let userId: number;
beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: "__reports", email: `${crypto.randomUUID()}@example.test` } })).id;
  await prisma.income.create({ data: { userId, type: "salary", amount: 9000.4, incomeDate: new Date("2026-08-10") } });
  await prisma.expense.create({ data: { userId, amount: 1200.15, expenseDate: new Date("2026-08-11") } });
  const confirmed = await prisma.creditImport.create({ data: { userId, fileName: "c", importMonth: 8, importYear: 2026, status: "confirmed" } });
  const draft = await prisma.creditImport.create({ data: { userId, fileName: "d", importMonth: 8, importYear: 2026, status: "pending" } });
  const row = { userId, businessName: "x", billingDate: new Date("2026-08-12"), transactionDate: new Date("2026-08-12") };
  await prisma.creditTransaction.createMany({ data: [
    { ...row, creditImportId: confirmed.id, amount: 300.3 },
    { ...row, creditImportId: confirmed.id, amount: 5000, transactionType: "financing" },
    { ...row, creditImportId: draft.id, amount: 77 },
  ] });
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("monthly totals have one source", () => {
  it("reports, the dashboard summary and insights all read monthTotals", async () => {
    const totals = await monthTotals(userId, 2026, 8);
    expect(totals).toEqual({ incomeTotal: 9000.4, expenseTotal: 1500.45, creditTotal: 300.3, balance: 7499.95 });
    const report = await reportsService.monthly(userId, 2026, 8);
    expect(report.current).toMatchObject({ incomeTotal: totals.incomeTotal, expenseTotal: totals.expenseTotal, balance: totals.balance });
    const trend = await reportsService.trend(userId, 2026, 8, 1);
    expect(trend[0]).toMatchObject({ incomeTotal: totals.incomeTotal, expenseTotal: totals.expenseTotal, balance: totals.balance });
    expect((await dashboardService.summary(userId, 2026, 8)).balance).toBe(totals.balance);
    await expect(buildInsights(userId, 2026, 8)).resolves.toBeDefined();
  });
});
