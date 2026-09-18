import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { accountBalanceService } from "../bank/accountBalance.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { commitments, type Commitment } from "./commitments.service";
import { financialStatus } from "./coverage.service";
import { businessDate, nextDate } from "./journey.utils";

let userId: number;
let token: string;
const today = businessDate();
beforeEach(async () => {
  userId = 0;
  userId = (await prisma.user.create({ data: { name: "__commitments_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { if (userId) await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
const decide = (event: Commitment, decision: string, extra = {}) => request(app).post("/api/journey/commitments/decision").set(headers()).send({ key: event.key, fingerprint: event.fingerprint, decision, note: "verified for test", ...extra });
async function reminder(title: string, amount: number, day = today) {
  const row = await prisma.reminder.create({ data: { userId, title, estimatedAmount: amount, eventDate: new Date(day), type: "expected_expense" } });
  return (await commitments(userId)).find(e => e.key === `reminder:${row.id}:${day}`)!;
}
async function bankPayment(amount: number, day = today) {
  const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
  return prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, amount, transactionDate: new Date(day), type: "withdrawal" } });
}

describe("commitment evidence and coverage", () => {
  it("does not treat a nonfinancial reminder as unknown debt", async () => {
    await prisma.reminder.create({ data: { userId, title: "Birthday", type: "birthday", eventDate: new Date(today) } });
    expect(await commitments(userId)).toEqual([]);
    await prisma.reminder.create({ data: { userId, title: "Unknown bill", type: "expected_expense", eventDate: new Date(today) } });
    expect((await commitments(userId))[0].amount).toBeNull();
  });

  it("keeps acknowledged overdue debt when the schedule is advanced", async () => {
    const oldDate = nextDate(today, -90);
    const row = await prisma.recurringPayment.create({ data: { userId, name: "rent", amount: 100, nextPaymentDate: new Date(oldDate), frequency: "monthly" } });
    const event = (await commitments(userId)).find(e => e.key === `recurring:${row.id}:${oldDate}`)!;
    expect((await decide(event, "unpaid")).status).toBe(200);
    await prisma.recurringPayment.update({ where: { id: row.id }, data: { nextPaymentDate: new Date(nextDate(today, 10)) } });
    expect((await commitments(userId)).find(e => e.key === event.key)).toMatchObject({ amount: 100, decision: "unpaid" });
    expect((await decide(event, "paid")).status).toBe(200);
    const saved = await prisma.commitmentDecision.findFirstOrThrow({ where: { userId, eventKey: event.key } });
    expect(saved.history).toHaveLength(2);
  });

  it("requires separate acknowledgement of the current sources", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test", anchorBalance: 1000, anchorDate: new Date(today) } });
    const state = await financialStatus(userId);
    expect((await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: state.dataVersion, confirmed: true })).status).toBe(409);
    expect(state.sources[0]).toMatchObject({ reportedFrom: null, reportedTo: null, asOf: today });
  });

  it("excludes future manual anchors and transactions from today's balance", async () => {
    const payment = await bankPayment(60, nextDate(today, 1));
    await prisma.bankAccount.update({ where: { id: payment.bankAccountId }, data: { initialBalance: 100, anchorDate: new Date(nextDate(today, 1)), anchorBalance: 5000 } });
    expect(await accountBalanceService.derive(userId, payment.bankAccountId)).toMatchObject({ balance: 100, basis: "accumulated", anchor: null });
    await prisma.bankStatementImport.create({ data: { userId, bankAccountId: payment.bankAccountId, fileName: "today.xlsx", fileHash: crypto.randomBytes(32).toString("hex"), coverageFrom: new Date(today), coverageTo: new Date(today), closingBalance: 200, parsedRows: 1 } });
    expect(await accountBalanceService.derive(userId, payment.bankAccountId)).toMatchObject({ balance: 200, basis: "statement", anchor: { coverageTo: today } });
  });

  it("keeps an unpaid obligation more than 31 days overdue", async () => {
    const event = await reminder("old debt", 120, nextDate(today, -90));
    expect(event).toBeDefined();
    expect((await decide(event, "unpaid")).status).toBe(200);
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBe("unpaid");
  });

  it("retains old card bills and blocks financing whose repayment is not matched", async () => {
    const date = new Date(nextDate(today, -90));
    const imported = await prisma.creditImport.create({ data: { userId, fileName: "test.xlsx", importMonth: 1, importYear: 2026, status: "confirmed" } });
    const transaction = await prisma.creditTransaction.create({ data: { userId, creditImportId: imported.id, businessName: "old bill", amount: 60, transactionDate: date, billingDate: date, chargeDate: date } });
    expect((await commitments(userId)).find(e => e.kind === "credit")).toMatchObject({ date: nextDate(today, -90), amount: 60, decision: null });
    await prisma.creditTransaction.update({ where: { id: transaction.id }, data: { transactionType: "financing" } });
    const state = await financialStatus(userId);
    expect(state.blockers.some(b => b.includes("עסקאות מימון"))).toBe(true);
    expect(state.allowance.amount).toBeNull();
  });

  it("includes overdue loans and installments older than the display window", async () => {
    const date = new Date(nextDate(today, -90));
    const loan = await prisma.loan.create({ data: { userId, loanName: "overdue", loanType: "bank", originalAmount: 100, currentBalance: 100, annualInterestRate: 0, monthlyPayment: 100, startDate: date, status: "overdue", scheduleSource: "computed", endDate: date } });
    expect((await commitments(userId)).find(e => e.key === `loan:${loan.id}:${nextDate(today, -90)}`)).toMatchObject({ amount: 100, decision: null });
  });

  it("rejects duplicate allocations exceeding their target and invalidates existing over-allocation", async () => {
    const target = await reminder("card bill", 100);
    const a = await reminder("subscription A", 60);
    const b = await reminder("subscription B", 60);
    expect((await decide(target, "unpaid")).status).toBe(200);
    const outcomes = await Promise.all([decide(a, "duplicate", { relatedEventKey: target.key }), decide(b, "duplicate", { relatedEventKey: target.key })]);
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 409]);
    // Also protect reads of decisions saved by an earlier version of the app.
    for (const event of [a, b]) {
      const data = { fingerprint: event.fingerprint, decision: "duplicate", relatedEventKey: target.key, note: "legacy match" };
      await prisma.commitmentDecision.upsert({ where: { userId_eventKey: { userId, eventKey: event.key } }, create: { userId, eventKey: event.key, ...data }, update: data });
    }
    const events = await commitments(userId);
    expect(events.filter(e => [a.key, b.key].includes(e.key)).map(e => e.decision)).toEqual([null, null]);
  });

  it("allows multiple duplicate matches when their total fits", async () => {
    const target = await reminder("bill", 100);
    const a = await reminder("part A", 60);
    const b = await reminder("part B", 40);
    await decide(target, "unpaid");
    expect((await decide(a, "duplicate", { relatedEventKey: target.key })).status).toBe(200);
    expect((await decide(b, "duplicate", { relatedEventKey: target.key })).status).toBe(200);
    expect((await commitments(userId)).filter(e => e.decision === "duplicate")).toHaveLength(2);
  });

  it("invalidates a linked payment after edits or deletion and permits explicit re-verification", async () => {
    const event = await reminder("payment", 60);
    const payment = await bankPayment(60);
    expect((await decide(event, "paid", { bankTransactionId: payment.id })).status).toBe(200);
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBe("paid");
    await prisma.bankTransaction.update({ where: { id: payment.id }, data: { amount: 50 } });
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBeNull();
    await prisma.bankTransaction.update({ where: { id: payment.id }, data: { amount: 60 } });
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBeNull();
    expect((await decide(event, "paid", { bankTransactionId: payment.id })).status).toBe(200);
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBe("paid");
    await prisma.bankTransaction.delete({ where: { id: payment.id } });
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBeNull();
  });

  it("does not call a partly paid obligation settled", async () => {
    const event = await reminder("partly paid", 100);
    const payment = await bankPayment(40);
    expect((await decide(event, "paid", { bankTransactionId: payment.id })).status).toBe(400);
    expect((await commitments(userId)).find(e => e.key === event.key)?.decision).toBeNull();
  });

  it("rejects future payments and attaching bank evidence to an unpaid decision", async () => {
    const event = await reminder("payment", 60);
    const payment = await bankPayment(60, nextDate(today, 1));
    expect((await decide(event, "paid", { bankTransactionId: payment.id })).status).toBe(400);
    expect((await decide(event, "unpaid", { bankTransactionId: payment.id })).status).toBe(400);
  });

  it("invalidates coverage on expense and income creation, edit, and deletion", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test", anchorBalance: 1000, anchorDate: new Date(today) } });
    await request(app).patch("/api/journey/profile").set(headers()).send({ scope: { accountsListed: true, cardsListed: true, commitmentsListed: true, manualOnly: true } });
    const versions: string[] = [(await financialStatus(userId)).dataVersion];
    const confirm = async (dataVersion: string) => {
      expect((await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion, confirmed: true, sourceKeys: (await financialStatus(userId)).sources.map(s=>s.key) })).status).toBe(200);
      expect((await financialStatus(userId)).allowance.amount).not.toBeNull();
    };
    await confirm(versions[0]);
    const record = async () => {
      const state = await financialStatus(userId);
      versions.push(state.dataVersion);
      expect(state.allowance.amount).toBeNull();
      await confirm(state.dataVersion);
    };
    const expense = await prisma.expense.create({ data: { userId, amount: 10, expenseDate: new Date(today) } });
    await record();
    await prisma.expense.update({ where: { id: expense.id }, data: { amount: 20 } });
    await record();
    await prisma.expense.delete({ where: { id: expense.id } });
    await record();
    const income = await prisma.income.create({ data: { userId, amount: 100, incomeDate: new Date(today), type: "extra" } });
    await record();
    await prisma.income.update({ where: { id: income.id }, data: { amount: 200 } });
    await record();
    await prisma.income.delete({ where: { id: income.id } });
    await record();
    for (let i = 1; i < versions.length; i++) expect(versions[i]).not.toBe(versions[i - 1]);
  });
});
