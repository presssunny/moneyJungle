import crypto from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { financialStatus } from "./coverage.service";

let userId: number;
beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__multi_account_test", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });

describe("multi-account allowance blocker (test-gap closure)", () => {
  it("blocks the daily allowance once a second bank account exists, without touching monthly totals", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "A" } });
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "B" } });
    const status = await financialStatus(userId);
    expect(status.allowance.state).toBe("unavailable");
    expect(status.blockers.some(b => b.includes("כמה חשבונות"))).toBe(true);
  });

  it("does not fire the multi-account blocker for a single bank account", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "A" } });
    const status = await financialStatus(userId);
    expect(status.blockers.some(b => b.includes("כמה חשבונות"))).toBe(false);
  });

  it("a second credit card, without a second bank account, does not trigger the multi-account blocker", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "A" } });
    await prisma.creditCard.create({ data: { userId, name: "card1", issuer: "test", lastFour: "1111" } });
    await prisma.creditCard.create({ data: { userId, name: "card2", issuer: "test", lastFour: "2222" } });
    const status = await financialStatus(userId);
    expect(status.blockers.some(b => b.includes("כמה חשבונות"))).toBe(false);
  });
});
