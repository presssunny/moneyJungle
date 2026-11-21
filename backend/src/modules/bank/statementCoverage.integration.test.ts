import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { dashboardService } from "../dashboard/dashboard.service";
import { financialMetric } from "../journey/metrics.service";

let userId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__statement_coverage_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "עו״ש" } });
  // The pending sync's shape: rows from 26/07 to 22/10.
  await prisma.bankStatementImport.create({ data: { userId, bankAccountId: account.id, fileName: "sync.xlsx", fileHash: crypto.randomUUID().replace(/-/g, ""),
    coverageFrom: new Date("2026-07-26"), coverageTo: new Date("2026-10-22") } });
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("a month the statements cover only in part", () => {
  it("the dashboard says so, and a fully covered month says complete", async () => {
    expect((await dashboardService.summary(userId, 2026, 7)).coverage).toEqual({ state: "partial", from: "2026-07-26", to: "2026-07-31" });
    expect((await dashboardService.summary(userId, 2026, 8)).coverage).toMatchObject({ state: "complete" });
    expect((await dashboardService.summary(userId, 2026, 5)).coverage).toEqual({ state: "unknown" });
  });

  it("the month's income and expense explanation names the gap", async () => {
    const metric = await financialMetric(userId, "expense", "2026-07");
    expect(metric.missingData.join(" ")).toMatch(/מכוסה חלקית בדוחות הבנק: 2026-07-26–2026-07-31/);
  });
});
