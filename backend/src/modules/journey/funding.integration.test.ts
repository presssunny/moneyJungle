import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { financialStatus } from "./coverage.service";
import { businessDate, nextDate } from "./journey.utils";

let userId: number;
let token: string;
const today = businessDate();
const end = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });

async function account(name: string, balance: number, anchored = true) {
  return prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: name, ...(anchored ? { anchorBalance: balance, anchorDate: new Date(today) } : { initialBalance: balance, currentBalance: balance }) } });
}
/** A reminder due today, marked unpaid — the simplest dated obligation. */
async function obligation(title: string, amount: number, date = today) {
  const reminder = await prisma.reminder.create({ data: { userId, title, eventDate: new Date(date), estimatedAmount: amount, type: "expected_expense" } });
  const state = await financialStatus(userId);
  const event = state.events.find((e) => e.key === `reminder:${reminder.id}:${date}`)!;
  expect((await request(app).post("/api/journey/commitments/decision").set(headers()).send({ key: event.key, fingerprint: event.fingerprint, decision: "unpaid", note: "טרם שולם" })).status).toBe(200);
  return reminder;
}
async function acknowledge() {
  const state = await financialStatus(userId);
  expect((await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: state.dataVersion, confirmed: true, sourceKeys: state.sources.map((s) => s.key) })).status).toBe(200);
  return financialStatus(userId);
}

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__funding", email: `${crypto.randomUUID()}@example.test` } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  await request(app).patch("/api/journey/profile").set(headers()).send({ scope: { accountsListed: true, cardsListed: true, commitmentsListed: true, manualOnly: true } });
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("single account: unchanged by funding allocation", () => {
  it("plans from the one account's cash, its obligations and every reserve", async () => {
    await account("עו״ש", 1000);
    await prisma.financialProfile.update({ where: { userId }, data: { cashBuffer: 100, savedReserve: 50 } });
    await obligation("ארנונה", 300);
    const state = await acknowledge();
    const days = Math.round((Date.parse(end) - Date.parse(today)) / 86400000) + 1;
    expect(state.allowance.state).toBe("provisional");
    expect(state.allowance.cash).toBe(1000);
    expect(state.allowance.amount).toBe(Math.floor(((1000 - 150 - 300) / days) * 100) / 100);
    expect(state.blockers).toEqual([]);
  });
});

describe("several accounts: plan from one spending account", () => {
  const fund = (body: object) => request(app).put("/api/journey/funding").set(headers()).send(body);
  const days = () => Math.round((Date.parse(end) - Date.parse(today)) / 86400000) + 1;

  it("asks for a spending account, then plans from its cash alone", async () => {
    const main = await account("עו״ש", 1000);
    await account("חיסכון", 50000);
    let state = await acknowledge();
    expect(state.allowance.amount).toBeNull();
    expect(state.blockers.some((b) => b.includes("יש לבחור את החשבון"))).toBe(true);
    expect((await fund({ spendingAccountId: main.id })).status).toBe(200);
    state = await acknowledge();
    expect(state.blockers).toEqual([]);
    expect(state.allowance.cash).toBe(51000);
    expect(state.allowance.cashInPlan).toBe(1000);
    expect(state.allowance.amount).toBe(Math.floor((1000 / days()) * 100) / 100);
  });

  it("keeps an obligation without a confirmed payer blocking, even when a statement suggests one", async () => {
    const main = await account("עו״ש", 1000);
    const other = await account("משני", 0);
    const card = await prisma.creditCard.create({ data: { userId, name: "ויזה", issuer: "כאל", lastFour: "4321" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: other.id, amount: 200, type: "withdrawal", transactionDate: new Date(nextDate(today, -30)), description: "כאל 4321", resolution: "credit_card_settled" } });
    const reminder = await obligation("ועד בית", 200);
    await fund({ spendingAccountId: main.id });
    const overview = (await request(app).get("/api/journey/funding").set(headers())).body;
    expect(overview.sources.find((s: { sourceKey: string }) => s.sourceKey === `credit:${card.id}`)).toMatchObject({ assignedAccountId: null, suggestedAccountId: other.id });
    let state = await acknowledge();
    expect(state.blockers.some((b) => b.includes("לא נקבע חשבון משלם ל: ועד בית"))).toBe(true);
    expect(state.allowance.amount).toBeNull();
    await fund({ assignments: [{ sourceKey: `reminder:${reminder.id}`, bankAccountId: main.id }] });
    state = await acknowledge();
    // The card's own missing statement still blocks; the payer question is answered.
    expect(state.blockers.some((b) => b.includes("לא נקבע חשבון משלם"))).toBe(false);
    expect(state.allowance.obligations.map((o) => o.name)).toEqual(["ועד בית"]);
  });

  it("offers no suggestion for a card paid from two accounts or named only by its issuer", async () => {
    const a = await account("א", 100);
    const b = await account("ב", 100);
    const twoAccounts = await prisma.creditCard.create({ data: { userId, name: "שני חשבונות", issuer: "כאל", lastFour: "1111" } });
    const issuerOnly = await prisma.creditCard.create({ data: { userId, name: "מנפיק בלבד", issuer: "ישראכרט", lastFour: "2222" } });
    const row = { userId, amount: 50, type: "withdrawal", transactionDate: new Date(nextDate(today, -20)), resolution: "credit_card_settled" };
    await prisma.bankTransaction.createMany({ data: [
      { ...row, bankAccountId: a.id, description: "כאל 1111" }, { ...row, bankAccountId: b.id, description: "כאל 1111" },
      { ...row, bankAccountId: a.id, description: "ישראכרט" },
    ] });
    const sources = (await request(app).get("/api/journey/funding").set(headers())).body.sources as Array<{ sourceKey: string; suggestedAccountId: number | null }>;
    expect(sources.find((s) => s.sourceKey === `credit:${twoAccounts.id}`)?.suggestedAccountId).toBeNull();
    expect(sources.find((s) => s.sourceKey === `credit:${issuerOnly.id}`)?.suggestedAccountId).toBeNull();
  });

  it("turns another account's shortfall into a transfer owed from the spending account, never adding its surplus", async () => {
    const main = await account("עו״ש", 1000);
    const other = await account("משני", 100);
    const rich = await account("עשיר", 9000);
    const rent = await obligation("שכירות", 400);
    const gym = await obligation("חדר כושר", 50);
    await fund({ spendingAccountId: main.id, assignments: [
      { sourceKey: `reminder:${rent.id}`, bankAccountId: other.id }, { sourceKey: `reminder:${gym.id}`, bankAccountId: rich.id },
    ] });
    const state = await acknowledge();
    expect(state.blockers).toEqual([]);
    expect(state.allowance.transfers).toEqual([{ accountId: other.id, name: "משני", amount: 300, date: today }]);
    expect(state.allowance.amount).toBe(Math.floor(((1000 - 300) / days()) * 100) / 100);
  });

  it("blocks when another account with charges this period has no balance verified for today", async () => {
    const main = await account("עו״ש", 1000);
    const other = await account("לא מעוגן", 100, false);
    const rent = await obligation("שכירות", 400);
    await fund({ spendingAccountId: main.id, assignments: [{ sourceKey: `reminder:${rent.id}`, bankAccountId: other.id }] });
    const state = await acknowledge();
    expect(state.blockers.some((b) => b.includes("נדרשת יתרה מאומתת להיום בחשבון: לא מעוגן"))).toBe(true);
    expect(state.allowance.amount).toBeNull();
  });

  it("deducts reserved savings only once the household says they sit in the spending account", async () => {
    const main = await account("עו״ש", 1000);
    await account("חיסכון", 5000);
    await prisma.financialProfile.update({ where: { userId }, data: { savedReserve: 400 } });
    await fund({ spendingAccountId: main.id });
    let state = await acknowledge();
    expect(state.blockers.some((b) => b.includes("באיזה חשבון מוחזק החיסכון"))).toBe(true);
    await fund({ savedReserveLocation: "elsewhere" });
    state = await acknowledge();
    expect(state.allowance.savedReserveCounted).toBe(0);
    expect(state.allowance.amount).toBe(Math.floor((1000 / days()) * 100) / 100);
    await fund({ savedReserveLocation: "spending" });
    state = await acknowledge();
    expect(state.allowance.amount).toBe(Math.floor((600 / days()) * 100) / 100);
  });

  it("keeps a negative spending balance negative", async () => {
    const main = await account("עו״ש", -200);
    await account("משני", 3000);
    await fund({ spendingAccountId: main.id });
    const state = await acknowledge();
    expect(state.allowance).toMatchObject({ amount: 0, shortfall: 200, cashInPlan: -200 });
  });

  it("changes the data version, so coverage must be confirmed again, when a payer changes", async () => {
    const main = await account("עו״ש", 1000);
    await account("משני", 100);
    await fund({ spendingAccountId: main.id });
    const before = await acknowledge();
    expect(before.coverageAcknowledged).toBe(true);
    await fund({ savedReserveLocation: "elsewhere" });
    const after = await financialStatus(userId);
    expect(after.dataVersion).not.toBe(before.dataVersion);
    expect(after.coverageAcknowledged).toBe(false);
  });

  it("refuses another owner's account or an unknown obligation", async () => {
    const stranger = (await prisma.user.create({ data: { name: "__funding_stranger" } })).id;
    try {
      const foreign = await prisma.bankAccount.create({ data: { userId: stranger, bankName: "x", accountName: "x" } });
      expect((await fund({ spendingAccountId: foreign.id })).status).toBe(400);
      const mine = await account("עו״ש", 10);
      expect((await fund({ assignments: [{ sourceKey: "reminder:999999999", bankAccountId: mine.id }] })).status).toBe(400);
      expect((await fund({ assignments: [{ sourceKey: "bank:1", bankAccountId: mine.id }] })).status).toBe(400);
    } finally { await prisma.user.delete({ where: { id: stranger } }); }
  });
});
