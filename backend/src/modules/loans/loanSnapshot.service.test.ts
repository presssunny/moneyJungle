import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { ScrapedLoan } from "../../types/connections.types";
import type { LoanDetailsPreview } from "../../types/siteSnapshot.types";
import { importSessions, type ImportPreview } from "../imports/importSession.service";
import { loanDetailsFile, loanDigits, matchSnapshotLoans, readLoanDetailsFile, siteFigures } from "./loanSnapshot.service";
import { loansService } from "./loans.service";

// Made-up figures. The banker's ruling of 2026-11-14 for a bank-site loan snapshot (CLAUDE.md §5, §7 A2).
const snap = (overrides: Partial<ScrapedLoan> = {}): ScrapedLoan => ({
  loanNumber: "0108", trackNumber: null, name: "מסלול א", asOf: "2026-11-01", originalAmount: 90000, principalBalance: 50000, indexedBalance: null,
  interestType: "fixed", annualInterestRate: 5.126, primeMargin: null, indexLinked: false, baseIndex: null, baseIndexMonth: null,
  paymentsMade: 10, paymentsTotal: 60, startDate: "2025-12-10", endDate: "2030-11-10", nextPaymentAmount: 1020, nextPaymentDate: "2026-12-10", schedule: [], ...overrides,
});

let userId: number;
let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;

const loan = (data: { loanNumber: string; scheduleSource: string; status?: "active" | "finished"; currentBalance?: number | null; annualInterestRate?: number | null; trackNumber?: string | null; endDate?: Date | null; monthlyPayment?: number }) =>
  prisma.loan.create({ data: { userId, loanName: `הלוואה ${data.loanNumber}`, loanType: "bank", monthlyPayment: 1000, startDate: new Date("2026-08-10"), originalAmount: null, originalAmountSource: "unknown", ...data } });
const row = (id: number) => prisma.loan.findUniqueOrThrow({ where: { id } });

/** Through the import screen's own path: the sync's session, then her approval. */
async function approve(loans: ScrapedLoan[]) {
  const created = await importSessions.create(userId, `סנכרון פרטי הלוואות ${crypto.randomUUID()}.json`, loanDetailsFile(loans), { kind: "loan_details" }, "sync");
  expect(created.status).toBe("ready_for_review");
  const before = (created.preview as unknown as ImportPreview).siteSnapshot as LoanDetailsPreview;
  const committed = await importSessions.commit(userId, created.id, created.version);
  return { before, after: (committed.preview as unknown as ImportPreview).siteSnapshot as LoanDetailsPreview, committed };
}

beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-loan-snapshot-")); env.DOCUMENT_STORAGE_DIR = storage; });
beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__loan_snapshot_test", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

describe("the figures a snapshot can stand behind", () => {
  // Edge 8: an early-repayment figure never arrives as the balance; with no balance shown there is none to store.
  it("no balance on the page → none, never 0", () => {
    expect(siteFigures(snap({ principalBalance: null })).currentBalance).toBeNull();
  });

  // Edge 9.
  it("an index-linked loan's balance is the bank's revalued one, or nothing", () => {
    expect(siteFigures(snap({ indexLinked: true, principalBalance: 50000, indexedBalance: null })).currentBalance).toBeNull();
    expect(siteFigures(snap({ indexLinked: true, principalBalance: 50000, indexedBalance: 53210.5 })).currentBalance).toBe(53210.5);
    expect(siteFigures(snap({ indexLinked: null, principalBalance: 50000, indexedBalance: 53210.5 })).currentBalance).toBeNull();
    expect(siteFigures(snap({ indexLinked: null, principalBalance: 50000, indexedBalance: null })).currentBalance).toBe(50000);
  });

  // Edge 10.
  it("a prime margin alone is not a rate; an explicit total rate is kept to two decimals", () => {
    expect(siteFigures(snap({ interestType: "prime", annualInterestRate: null, primeMargin: 0.5 })).annualInterestRate).toBeNull();
    expect(siteFigures(snap({ interestType: "prime", annualInterestRate: 6.555, primeMargin: 0.5 })).annualInterestRate).toBe(6.56);
  });

  it("the same read is the same file, and the file reads back without its (empty) schedule", () => {
    expect(loanDetailsFile([snap(), snap({ trackNumber: "2" })])).toEqual(loanDetailsFile([snap({ trackNumber: "2" }), structuredClone(snap())]));
    expect(readLoanDetailsFile(loanDetailsFile([snap()]))?.[0]).not.toHaveProperty("schedule");
    expect(readLoanDetailsFile(Buffer.from("{\"format\":\"other\"}"))).toBeNull();
  });
});

describe("matching a snapshot track to her loans", () => {
  // Edge 7.
  it("'0108' is '108'; the last four digits on two loans is ambiguous, never a pick", async () => {
    expect(loanDigits("0108")).toBe(loanDigits("108"));
    expect(loanDigits("12-345108")).toBe("5108");
    const a = await loan({ loanNumber: "55108", scheduleSource: "statement" });
    const b = await loan({ loanNumber: "65108", scheduleSource: "statement" });
    const { after } = await approve([snap({ loanNumber: "5108" })]);
    expect(after.loans[0].match).toMatchObject({ loanId: null, reason: "ambiguous" });
    expect([await row(a.id), await row(b.id)].map((l) => l.currentBalance)).toEqual([null, null]);
  });

  it("never by amount alone: no number is ambiguous, and an amount out of tolerance is ambiguous", async () => {
    const statement = await loan({ loanNumber: "108", scheduleSource: "computed", currentBalance: 1, annualInterestRate: 1 });
    expect(matchSnapshotLoans([snap({ loanNumber: "abc" })], [statement], [])[0].reason).toBe("ambiguous");
    expect(matchSnapshotLoans([snap({ nextPaymentAmount: 1100 })], [statement], [])[0].reason).toBe("ambiguous");
    expect(matchSnapshotLoans([snap({ nextPaymentAmount: null })], [statement], [])[0].reason).toBe("matched");
    expect(matchSnapshotLoans([snap({ trackNumber: "7" })], [{ ...statement, trackNumber: "8" }], [])[0].reason).toBe("no_loan");
  });

  // Edge 11.
  it("a loan she does not have is listed as no_loan, and no loan is created", async () => {
    await loan({ loanNumber: "108", scheduleSource: "statement" });
    const before = await prisma.loan.count({ where: { userId } });
    const { after } = await approve([snap({ loanNumber: "7777" })]);
    expect(after.loans[0].match).toEqual({ loanId: null, loanName: null, checkingLines: 0, reason: "no_loan" });
    expect(await prisma.loan.count({ where: { userId } })).toBe(before);
  });

  it("counts the checking account's payment days of that loan number", async () => {
    const accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
    for (const day of ["2026-09-10", "2026-10-10"]) {
      await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date(day), description: "הלוואה - תשלום קרן 108", amount: 900, type: "withdrawal", lineKind: "loan_principal", loanRef: "108" } });
    }
    await loan({ loanNumber: "108", scheduleSource: "statement" });
    const created = await importSessions.create(userId, "x.json", loanDetailsFile([snap()]), { kind: "loan_details", accountId }, "sync");
    expect(((created.preview as unknown as ImportPreview).siteSnapshot as LoanDetailsPreview).loans[0].match).toMatchObject({ reason: "matched", checkingLines: 2 });
  });
});

describe("what approving a snapshot writes", () => {
  // Edge 1.
  it("a statement loan with two snapshot tracks on its number is ambiguous: nothing written", async () => {
    const statement = await loan({ loanNumber: "108", scheduleSource: "statement" });
    const before = await row(statement.id);
    const { after } = await approve([snap({ trackNumber: "1", nextPaymentAmount: 1000 }), snap({ trackNumber: "2", nextPaymentAmount: 400 })]);
    expect(after.loans.map((l) => l.match.reason)).toEqual(["ambiguous", "ambiguous"]);
    expect(await row(statement.id)).toEqual(before);
  });

  // Edge 2.
  it("a statement loan with one track: only its empty fields are filled; monthlyPayment, startDate and the original amount never", async () => {
    const statement = await loan({ loanNumber: "108", scheduleSource: "statement", annualInterestRate: 4 });
    const { before, after } = await approve([snap({ indexLinked: true, indexedBalance: 51000.4 })]);
    expect(before.loans[0].fills.map((f) => f.field)).toEqual(["currentBalance", "endDate", "totalPayments", "paymentsMade", "isIndexLinked"]);
    expect(after.loans[0].notes).toEqual(["ריבית שנתית: הבנק מציג 5.13"]);
    const updated = await row(statement.id);
    expect(Number(updated.currentBalance)).toBe(51000.4);
    expect(Number(updated.annualInterestRate)).toBe(4);
    expect(updated.endDate?.toISOString().slice(0, 10)).toBe("2030-11-10");
    expect([updated.totalPayments, updated.paymentsMade, updated.isIndexLinked, updated.trackNumber]).toEqual([60, 10, true, null]);
    expect(Number(updated.monthlyPayment)).toBe(1000);
    expect(updated.startDate.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect([updated.originalAmount, updated.originalAmountSource, updated.scheduleSource]).toEqual([null, "unknown", "statement"]);
    expect(updated.siteSnapshotAsOf?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  });

  it("a statement loan with a snapshot that names no next payment is ambiguous", async () => {
    await loan({ loanNumber: "108", scheduleSource: "statement" });
    expect((await approve([snap({ nextPaymentAmount: null })])).after.loans[0].match.reason).toBe("ambiguous");
  });

  // Edge 3.
  it("a loan from her bank file is never written; a balance more than 1% apart warns the schedule may be old", async () => {
    const fromFile = await loan({ loanNumber: "108", scheduleSource: "bank_file", currentBalance: 40000, annualInterestRate: null, endDate: null });
    const before = await row(fromFile.id);
    const { after } = await approve([snap()]);
    expect(after.loans[0]).toMatchObject({ match: { loanId: fromFile.id, reason: "matched" }, fills: [] });
    expect(after.loans[0].notes).toEqual([expect.stringContaining("ייתכן שהלוח ישן")]);
    expect(await row(fromFile.id)).toEqual(before);
    expect((await approve([snap({ principalBalance: 40300 })])).after.loans[0].notes).toEqual([]);
  });

  // Edge 4.
  it("a computed loan keeps her balance and rate, shows the bank's beside them, and fills only what is empty", async () => {
    const hers = await loan({ loanNumber: "108", scheduleSource: "computed", currentBalance: 45000, annualInterestRate: 5.13, trackNumber: "0007" });
    const { after } = await approve([snap({ trackNumber: "7" })]);
    expect(after.loans[0].notes).toEqual(["יתרה: הבנק מציג 50000"]);
    const updated = await row(hers.id);
    expect([Number(updated.currentBalance), Number(updated.annualInterestRate), updated.trackNumber, updated.totalPayments, updated.paymentsMade]).toEqual([45000, 5.13, "0007", 60, 10]);
    expect(updated.endDate?.toISOString().slice(0, 10)).toBe("2030-11-10");
    expect(updated.isIndexLinked).toBe(false);
  });

  // Edge 5.
  it("a finished loan is untouched and never reopened", async () => {
    const closed = await loan({ loanNumber: "108", scheduleSource: "statement", status: "finished" });
    const before = await row(closed.id);
    expect((await approve([snap()])).after.loans[0].match.reason).toBe("no_loan");
    expect(await row(closed.id)).toEqual(before);
  });

  // Edge 6.
  it("only a later snapshot replaces what an earlier one wrote, and never after she edits it", async () => {
    const statement = await loan({ loanNumber: "108", scheduleSource: "statement" });
    const balance = async () => Number((await row(statement.id)).currentBalance);
    await approve([snap({ asOf: "2026-11-01", principalBalance: 50000 })]);
    expect(await balance()).toBe(50000);
    await approve([snap({ asOf: "2026-10-01", principalBalance: 49000 })]);
    expect(await balance()).toBe(50000);
    await approve([snap({ asOf: "2026-12-01", principalBalance: 48000 })]);
    expect(await balance()).toBe(48000);
    expect((await row(statement.id)).siteSnapshotAsOf?.toISOString().slice(0, 10)).toBe("2026-12-01");

    await loansService.update(userId, statement.id, { currentBalance: 47000 });
    expect((await row(statement.id)).siteSnapshotAsOf).toBeNull();
    const { after } = await approve([snap({ asOf: "2027-01-01", principalBalance: 46000 })]);
    expect(await balance()).toBe(47000);
    expect(after.loans[0].notes).toContain("יתרה: הבנק מציג 46000");
  });

  // Edge 8 and 9, end to end: nothing it cannot stand behind reaches the loan.
  it("no balance shown, or a linked loan with only its nominal balance: the balance stays unknown", async () => {
    const first = await loan({ loanNumber: "108", scheduleSource: "statement" });
    const { after } = await approve([snap({ principalBalance: null })]);
    expect(after.loans[0].missing).toContain("principalBalance");
    expect((await row(first.id)).currentBalance).toBeNull();
    const linked = await loan({ loanNumber: "209", scheduleSource: "statement" });
    const linkedRun = await approve([snap({ loanNumber: "209", indexLinked: true, indexedBalance: null })]);
    expect(linkedRun.after.loans[0].missing).toContain("indexedBalance");
    expect((await row(linked.id)).currentBalance).toBeNull();
    expect((await row(linked.id)).isIndexLinked).toBe(true);
  });

  // Edge 10, end to end.
  it("a prime loan with only its margin gets no rate", async () => {
    const prime = await loan({ loanNumber: "108", scheduleSource: "statement" });
    await approve([snap({ interestType: "prime", annualInterestRate: null, primeMargin: 0.5 })]);
    expect((await row(prime.id)).annualInterestRate).toBeNull();
  });

  it("shows interest type, linkage and the indexed balance in the preview, and lists what the page lacked", async () => {
    const { before } = await approve([snap({ interestType: "variable", indexLinked: null, indexedBalance: 1, endDate: null })]);
    expect(before.loans[0]).toMatchObject({ key: "loan:108:-", loanNumberLast4: "0108", interestType: "variable", indexLinked: null, indexedBalance: 1, asOf: "2026-11-01" });
    expect(before.loans[0].missing).toEqual(["endDate", "indexLinked"]);
  });
});
