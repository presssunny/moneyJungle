import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { hasFixture, readFixture } from "../../testing/fixtures";
import { loanScheduleService } from "./loanSchedule.service";

let userId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__loan_schedule_source_test", email: `${crypto.randomUUID()}@example.test` } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

function loanWith(originalAmount: number | null, originalAmountSource: string) {
  return prisma.loan.create({
    data: {
      userId, loanName: "הלוואה", loanType: "bank", originalAmount, originalAmountSource,
      currentBalance: null, annualInterestRate: null, monthlyPayment: 1000, startDate: new Date("2026-01-01"),
    },
  });
}

describe.skipIf(!hasFixture("loanSchedule562"))("a schedule import and the opening amount already on record", () => {
  it("fills an unknown opening amount, balance and rate from the bank's schedule", async () => {
    const loan = await loanWith(null, "unknown");
    await loanScheduleService.importSchedule(userId, readFixture("loanSchedule562"), loan.id, true);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.originalAmount).not.toBeNull();
    expect(after.originalAmountSource).not.toBe("unknown");
    expect(after.currentBalance).not.toBeNull();
    expect(after.annualInterestRate).not.toBeNull();
  });

  it("never replaces a contract amount she confirmed", async () => {
    const loan = await loanWith(123456, "contract");
    await loanScheduleService.importSchedule(userId, readFixture("loanSchedule562"), loan.id, true);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(Number(after.originalAmount)).toBe(123456);
    expect(after.originalAmountSource).toBe("contract");
  });
});
