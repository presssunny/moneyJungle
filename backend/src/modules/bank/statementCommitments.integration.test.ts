import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { existsSync, readFileSync } from "node:fs";
import { FIXTURES_DIR, hasFixture, readFixture } from "../../testing/fixtures";
import { businessDate } from "../../utils/date.utils";
import { commitments } from "../journey/commitments.service";
import { buildUpcoming } from "../dashboard/cashflow.service";
import { importSessions } from "../imports/importSession.service";
import { loanScheduleService } from "../loans/loanSchedule.service";
import { loansService } from "../loans/loans.service";
import { recurringService } from "../recurring/recurring.service";
import { statementCommitmentsService } from "./statementCommitments.service";

let userId: number;
let accountId: number;
let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;
const months = ["2026-07", "2026-08", "2026-09"];

async function seedStatement(statementMonths = months, principal = 900) {
  const rows = statementMonths.flatMap((m, i) => [
    { transactionDate: new Date(`${m}-15`), description: `משיכת שיק ${1000001 + i}`, amount: 4500, lineKind: "standard", loanRef: null },
    { transactionDate: new Date(`${m}-15`), description: "הלוואה - תשלום קרן 108", amount: principal, lineKind: "loan_principal", loanRef: "108" },
    { transactionDate: new Date(`${m}-15`), description: "הלוואה - תשלום ריבית 01040", amount: 300, lineKind: "loan_interest", loanRef: "01040" },
  ]);
  await prisma.bankTransaction.createMany({ data: rows.map((r) => ({ ...r, userId, bankAccountId: accountId, type: "withdrawal" })) });
}

beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-commitments-")); env.DOCUMENT_STORAGE_DIR = storage; });
beforeEach(async () => {
  // "Next payment" is counted from today; pin it so the dates below never go stale.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-20T09:00:00Z") });
  userId = (await prisma.user.create({ data: { name: "__statement_commitments_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
});
afterEach(async () => { vi.useRealTimers(); await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

describe("commitments a bank statement proves", () => {
  it("adds what was kept, remembers what was unchecked, and never adds twice", async () => {
    await seedStatement();
    const offered = await statementCommitmentsService.detect(userId, accountId);
    expect(offered.map((c) => c.kind).sort()).toEqual(["loan", "recurring"]);
    const cheque = offered.find((c) => c.kind === "recurring")!;

    const added = await statementCommitmentsService.apply(userId, accountId, [cheque.key]);
    expect(added.map((c) => c.kind)).toEqual(["loan"]);
    expect(await statementCommitmentsService.detect(userId, accountId)).toEqual([]);
    expect(await statementCommitmentsService.apply(userId, accountId, [])).toEqual([]);
    expect(await prisma.loan.count({ where: { userId } })).toBe(1);
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);
  });

  it("a loan with an unknown balance counts in the monthly forecast but is neither closed nor debt", async () => {
    await seedStatement();
    await statementCommitmentsService.apply(userId, accountId, []);
    const { loans: items, summary } = await loansService.list(userId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ scheduleSource: "statement", monthlyPayment: 1200, currentBalance: 0, loanNumber: "108" });
    expect(items[0].progress.lifecycle).toBe("active");
    expect(summary).toMatchObject({ totalBalance: 0, monthlyPayment: 1200 });

    const upcoming = await buildUpcoming(userId, 40, new Date("2026-09-20T00:00:00Z"));
    expect(upcoming.events.filter((e) => e.kind === "loan").map((e) => [e.date.slice(0, 10), e.amount])).toEqual([["2026-10-15", 1200]]);
  });

  it("a detected payment is never materialized as an expense — the next statement brings the real one", async () => {
    await seedStatement();
    await statementCommitmentsService.apply(userId, accountId, []);
    const recurring = await prisma.recurringPayment.findFirstOrThrow({ where: { userId } });
    expect(recurring).toMatchObject({ nextPaymentDate: new Date("2026-10-15") });
    expect(await recurringService.generate(userId, 2026, 10)).toMatchObject({ created: 0 });
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);

    await recurringService.remove(userId, recurring.id);
    expect((await statementCommitmentsService.detect(userId, accountId)).some((c) => c.kind === "recurring")).toBe(false);
  });

  it("a payment already entered by hand is not offered again — same payee, day and amount", async () => {
    await seedStatement();
    await prisma.recurringPayment.create({ data: { userId, name: "משיכת שיק", amount: 4500, nextPaymentDate: new Date("2026-10-14") } });
    expect((await statementCommitmentsService.detect(userId, accountId)).map((c) => c.kind)).toEqual(["loan"]);
  });

  it("a different payee of the same sum on the same day is still offered", async () => {
    await seedStatement();
    await prisma.recurringPayment.create({ data: { userId, name: "חוג", amount: 4500, nextPaymentDate: new Date("2026-10-15") } });
    expect((await statementCommitmentsService.detect(userId, accountId)).map((c) => c.kind).sort()).toEqual(["loan", "recurring"]);
  });

  it("a loan entered by hand with the same payment day and amount is not offered again", async () => {
    await seedStatement();
    await prisma.loan.create({ data: { userId, loanName: "הלוואת בנק", loanType: "bank", originalAmount: 50000, currentBalance: 30000, annualInterestRate: 5, monthlyPayment: 1200, startDate: new Date("2025-01-15") } });
    expect((await statementCommitmentsService.detect(userId, accountId)).map((c) => c.kind)).toEqual(["recurring"]);
  });

  it("only what the approval showed is added", async () => {
    await seedStatement();
    const [loan] = (await statementCommitmentsService.detect(userId, accountId)).filter((c) => c.kind === "loan");
    expect((await statementCommitmentsService.apply(userId, accountId, [], [loan.key])).map((c) => c.key)).toEqual([loan.key]);
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);
  });

  it("an early-repayment quote is refused while the balance is unknown", async () => {
    await seedStatement();
    await statementCommitmentsService.apply(userId, accountId, []);
    const loan = await prisma.loan.findFirstOrThrow({ where: { userId } });
    await expect(loansService.earlyRepaymentQuote(userId, loan.id)).rejects.toThrow(/לא ידועה/);
  });

  it.skipIf(!hasFixture("loanSchedule562"))("a schedule carves its track out of the statement loan — the monthly total does not drop", async () => {
    const statementLoan = (monthlyPayment: number) => prisma.loan.create({ data: { userId, loanName: "הלוואה 108", loanType: "bank", originalAmount: 0, currentBalance: 0,
      annualInterestRate: 0, monthlyPayment, startDate: new Date("2026-10-15"), loanNumber: "108", scheduleSource: "statement", detectedKey: "loan:108:15" } });
    const placeholder = await statementLoan(5000);
    const imported = await loanScheduleService.importSchedule(userId, readFixture("loanSchedule562"), placeholder.id, true);
    const loans = await prisma.loan.findMany({ where: { userId }, orderBy: { id: "asc" } });
    expect(loans).toHaveLength(2);
    expect(imported.loanId).not.toBe(placeholder.id);
    expect(loans.reduce((sum, l) => sum + Number(l.monthlyPayment), 0)).toBeCloseTo(5000, 2);

    // A statement loan that held just this track is replaced outright.
    const trackPayment = Number(loans[1].monthlyPayment);
    await prisma.loan.deleteMany({ where: { userId } });
    await statementLoan(trackPayment);
    await loanScheduleService.importSchedule(userId, readFixture("loanSchedule562"), undefined, true);
    expect(await prisma.loan.findMany({ where: { userId }, select: { scheduleSource: true } })).toEqual([{ scheduleSource: "bank_file" }]);
  });

  it("an old statement leaves no past month open — the first payment is the next one from today", async () => {
    await seedStatement(["2026-01", "2026-02", "2026-03"]);
    await statementCommitmentsService.apply(userId, accountId, []);
    const today = new Date(businessDate());
    const loan = await prisma.loan.findFirstOrThrow({ where: { userId } });
    const recurring = await prisma.recurringPayment.findFirstOrThrow({ where: { userId } });
    expect(loan.startDate.getTime()).toBeGreaterThan(today.getTime());
    expect(recurring.nextPaymentDate.getTime()).toBeGreaterThan(today.getTime());
    const open = (await commitments(userId)).filter((c) => c.date < businessDate() && c.decision === null);
    expect(open).toEqual([]);
  });

  it("a newer statement updates what an older one added", async () => {
    await seedStatement(["2026-01", "2026-02", "2026-03"]);
    await statementCommitmentsService.apply(userId, accountId, []);
    await prisma.bankTransaction.deleteMany({ where: { userId } });
    await seedStatement(months, 500);
    expect(await statementCommitmentsService.apply(userId, accountId, [])).toEqual([]);
    const loan = await prisma.loan.findFirstOrThrow({ where: { userId } });
    expect(Number(loan.monthlyPayment)).toBe(800);
  });

  it.skipIf(!hasFixture("bankStatementH1") || !existsSync(path.join(FIXTURES_DIR, "loan-schedule-3.xlsx")))("every track's schedule after a real statement leaves no ghost loan", async () => {
    const session = await importSessions.create(userId, "h1.xlsx", readFixture("bankStatementH1"), { kind: "bank", accountId });
    await importSessions.commit(userId, session.id, session.version, []);
    for (const file of ["loan-schedule-1.xlsx", "loan-schedule-2.xlsx", "loan-schedule-3.xlsx"]) {
      await loanScheduleService.importSchedule(userId, readFileSync(path.join(FIXTURES_DIR, file)), undefined, true);
    }
    expect(await prisma.loan.count({ where: { userId, scheduleSource: "statement" } })).toBe(0);
  });

  it.skipIf(!hasFixture("bankStatementH1"))("a real statement offers its commitments in the preview and adds them in the same approval", async () => {
    let session = await importSessions.create(userId, "h1.xlsx", readFixture("bankStatementH1"), { kind: "bank", accountId });
    const preview = session.preview as { commitments?: Array<{ key: string; kind: string }> };
    expect(preview.commitments?.filter((c) => c.kind === "loan")).toHaveLength(1);
    expect(preview.commitments!.length).toBeGreaterThanOrEqual(3);
    session = await importSessions.commit(userId, session.id, session.version, []);
    expect(await prisma.loan.count({ where: { userId, scheduleSource: "statement" } })).toBe(1);
    expect(await prisma.recurringPayment.count({ where: { userId, detectedKey: { not: null } } })).toBe(preview.commitments!.length - 1);
    expect(await statementCommitmentsService.detect(userId, accountId)).toEqual([]);
  });
});
