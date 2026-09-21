import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { businessDate } from "../../utils/date.utils";
import { monthTotals } from "../dashboard/dashboard.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { householdSnapshot, scanDuplicates } from "./householdAssistant.service";
import * as ai from "../ai/ai.service";

let userId: number;
let otherId: number;
let token: string;
const today = businessDate();
const [year, month] = today.split("-").map(Number);
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__household_assistant_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__household_assistant_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { vi.restoreAllMocks(); await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("household assistant with real persisted data", () => {
  it("returns deterministic steps when the provider fails, and rejects a plan made stale in flight", async () => {
    vi.spyOn(ai, "aiAvailable").mockReturnValue(true);
    const complete = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    vi.spyOn(ai, "getAiProvider").mockReturnValue({ name: "test", complete });
    const snapshot = await householdSnapshot(userId);
    const send = () => request(app).post("/api/household-assistant/plan").set(headers()).send({ version: snapshot.version, consent: true });
    const fallback = await send();
    expect(fallback.status).toBe(200);
    expect(fallback.body.mode).toBe("rules");
    expect(fallback.body.actionIds).toEqual(snapshot.actions.slice(0, 3).map(a => a.id));
    complete.mockImplementation(async () => {
      await prisma.income.create({ data: { userId, amount: 100, type: "salary", incomeDate: new Date(today) } });
      return { content: '{"actionIds":["task-0"]}' };
    });
    const stale = await send();
    expect(stale.status).toBe(200);
    expect(stale.body).toEqual({ version: snapshot.version, mode: "stale", actionIds: [] });
  });
  it("authenticates, rejects missing CSRF/consent and never trusts a client userId", async () => {
    expect((await request(app).get("/api/household-assistant")).status).toBe(401);
    expect((await request(app).get("/api/household-assistant").set("Cookie", `${sessionCookieName}=${token}`)).status).toBe(403);
    const snapshot = await householdSnapshot(userId);
    expect(snapshot.allowance.amount).toBeNull();
    expect(snapshot.hasActivity).toBe(false);
    expect(snapshot.actions[0].id).toBe("situation");
    expect((await request(app).post("/api/household-assistant/plan").set(headers()).send({ version: snapshot.version })).status).toBe(400);
    expect((await request(app).post("/api/household-assistant/plan").set(headers()).send({ version: snapshot.version, consent: true, userId: otherId })).status).toBe(400);
  });
  it("detects persisted duplicate evidence while preserving totals and tenant isolation", async () => {
    await prisma.expense.createMany({ data: [userId, userId, otherId, otherId].map(id => ({ userId: id, businessName: id === userId ? "קנייה לבדיקה" : "private-other-user", amount: 120.50, expenseDate: new Date(today) })) });
    const before = await monthTotals(userId, year, month);
    const response = await request(app).get("/api/household-assistant").set(headers());
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.duplicates.candidateCount).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain("private-other-user");
    expect(response.body.totals).toEqual(before);
    expect(await monthTotals(userId, year, month)).toEqual(before);
    expect(await prisma.expense.count({ where: { userId } })).toBe(2);
    expect((await householdSnapshot(userId)).version).toBe(response.body.version);
    await prisma.income.create({ data: { userId, amount: 1000, type: "salary", incomeDate: new Date(today) } });
    expect((await request(app).post("/api/household-assistant/plan").set(headers()).send({ version: response.body.version, consent: true })).status).toBe(409);
  });
  it("excludes linked bank outputs, draft credit, refunds, financing and installments", async () => {
    const bank = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    const expense = await prisma.expense.create({ data: { userId, businessName: "קנייה", amount: 100, expenseDate: new Date(today) } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: bank.id, amount: 100, type: "withdrawal", transactionDate: new Date(today), linkedExpenseId: expense.id } });
    await prisma.expense.create({ data: { userId, businessName: "קנייה", amount: 100, expenseDate: new Date(today) } });
    const card = await prisma.creditCard.create({ data: { userId, name: "test", issuer: "test", lastFour: "1111" } });
    const imported = await prisma.creditImport.create({ data: { userId, fileName: "test", importMonth: month, importYear: year, status: "confirmed" } });
    for (const transactionType of ["financing", "refund", "credit"]) {
      await prisma.creditTransaction.create({ data: { userId, cardId: card.id, creditImportId: imported.id, businessName: "קנייה", amount: 100, transactionDate: new Date(today), billingDate: new Date(today), transactionType } });
    }
    await prisma.creditTransaction.create({ data: { userId, cardId: card.id, creditImportId: imported.id, businessName: "קנייה", amount: 100, transactionDate: new Date(today), billingDate: new Date(today), paymentCount: 3 } });
    const draft = await prisma.creditImport.create({ data: { userId, fileName: "draft", importMonth: month, importYear: year } });
    await prisma.creditTransaction.create({ data: { userId, cardId: card.id, creditImportId: draft.id, businessName: "קנייה", amount: 100, transactionDate: new Date(today), billingDate: new Date(today) } });
    expect((await scanDuplicates(userId)).candidateCount).toBe(0);
    await prisma.creditTransaction.create({ data: { userId, cardId: card.id, creditImportId: imported.id, businessName: "קנייה", amount: 100, transactionDate: new Date(today), billingDate: new Date(today) } });
    expect((await scanDuplicates(userId)).candidates[0].reason).toBe("manual_and_card");
  });
});
