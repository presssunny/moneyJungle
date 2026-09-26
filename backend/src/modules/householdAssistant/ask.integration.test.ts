import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { businessDate } from "../../utils/date.utils";
import type { AiProvider } from "../ai/ai.types";
import { monthTotals } from "../dashboard/dashboard.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { askQuestion } from "./ask.service";
import { matchQuestion } from "./questions";

let userId: number;
let otherId: number;
let token: string;
const today = businessDate();
const [year, month] = today.split("-").map(Number);
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
const provider = (content: string) => { const complete = vi.fn().mockResolvedValue({ content }); return { provider: { name: "test", complete } satisfies AiProvider, complete }; };

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__ask", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__ask_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  const food = await prisma.category.create({ data: { userId, name: "מזון לבית" } });
  await prisma.expense.createMany({ data: [
    { userId, amount: 1234.56, businessName: "סופר פרטי מאוד", categoryId: food.id, expenseDate: new Date(today) },
    { userId, amount: 100, businessName: "אחר", expenseDate: new Date(today) },
  ] });
  await prisma.income.create({ data: { userId, type: "salary", amount: 5000, incomeDate: new Date(today) } });
});
afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("local question routing", () => {
  it("reads months, categories and document scope without a model", () => {
    expect(matchQuestion("כמה הוצאתי בחודש שעבר?", "2026-09-26", [], false)).toEqual({ intent: "month_totals", month: "previous" });
    expect(matchQuestion("כמה נכנס במרץ?", "2026-09-26", [], false)).toEqual({ intent: "month_totals", month: "2026-03" });
    // A month name later than today means last year's, never a future month.
    expect(matchQuestion("כמה הוצאתי בנובמבר?", "2026-09-26", [], false)).toEqual({ intent: "month_totals", month: "2025-11" });
    expect(matchQuestion("כמה הוצאתי על מזון לבית?", "2026-09-26", ["מזון", "מזון לבית"], false)).toEqual({ intent: "category_spend", month: "current", category: "מזון לבית" });
    expect(matchQuestion("כמה מותר להוציא היום?", "2026-09-26", [], false)).toEqual({ intent: "allowance" });
    expect(matchQuestion("כמה ריבית יש פה?", "2026-09-26", [], true)).toEqual({ intent: "document_interest" });
    expect(matchQuestion("מה מזג האוויר?", "2026-09-26", [], false)).toBeNull();
  });
});

describe("asking the household assistant", () => {
  it("answers a common question from monthTotals, without calling the model", async () => {
    const { provider: ai, complete } = provider("{}");
    const answer = await askQuestion(userId, { question: "כמה הוצאתי החודש?", consent: true }, ai);
    const totals = await monthTotals(userId, year, month);
    expect(answer).toMatchObject({ mode: "rules", intent: "month_totals" });
    expect(answer.facts.find((f) => f.label === "יצא")?.value).toBe(totals.expenseTotal);
    expect(answer.facts.find((f) => f.label === "נשאר")?.value).toBe(totals.balance);
    expect(complete).not.toHaveBeenCalled();
  });

  it("answers category spending from the categorizer's totals", async () => {
    const answer = await askQuestion(userId, { question: "כמה הוצאתי על מזון לבית?", consent: false }, null);
    expect(answer).toMatchObject({ mode: "rules", intent: "category_spend" });
    expect(answer.facts[0].value).toBe(1234.56);
  });

  it("does not send an unrecognised question anywhere without consent", async () => {
    const { provider: ai, complete } = provider('{"intent":"loans"}');
    const answer = await askQuestion(userId, { question: "איך הולך עם הכסף?", consent: false }, ai);
    expect(answer.mode).toBe("unanswered");
    expect(answer.examples.length).toBeGreaterThan(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it("lets the model choose only an intent, and never shows it a figure or a record", async () => {
    const { provider: ai, complete } = provider('{"intent":"goals"}');
    const answer = await askQuestion(userId, { question: "איך הולך עם הכסף?", consent: true }, ai);
    expect(answer).toMatchObject({ mode: "ai", intent: "goals" });
    const sent = JSON.stringify(complete.mock.calls[0][0]);
    for (const secret of ["1234.56", "סופר פרטי", "5000", "מזון לבית"]) expect(sent).not.toContain(secret);
    expect(complete.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['{"intent":"transfer_money"}', '{"intent":"loans","amount":5}', '{"intent":"document_summary"}', "not json", '{"intent":null}'])(
    "treats an invalid or out-of-scope choice as no answer: %s",
    async (content) => {
      expect((await askQuestion(userId, { question: "שאלה עמומה כלשהי", consent: true }, provider(content).provider)).mode).toBe("unanswered");
    },
  );

  it("answers a document's interest net of interest credits, and only for its owner", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    const statement = await prisma.bankStatementImport.create({ data: { userId, bankAccountId: account.id, fileName: "דף.xlsx", fileHash: "a".repeat(64), coverageFrom: new Date("2026-08-01"), coverageTo: new Date("2026-08-31") } });
    const row = { userId, bankAccountId: account.id, transactionDate: new Date("2026-08-15"), statementImportId: statement.id };
    await prisma.bankTransaction.createMany({ data: [
      { ...row, amount: 100, type: "withdrawal", resolution: "financing_charge" },
      { ...row, amount: 30, type: "deposit", resolution: "financing_credit" },
      { ...row, amount: 900, type: "withdrawal", resolution: "debt_reduction" },
    ] });
    const doc = await prisma.document.create({ data: { userId, fileName: "דף.xlsx", fileHash: "a".repeat(64), kind: "bank_statement", linkedStatementImportId: statement.id, coverageFrom: new Date("2026-08-01"), coverageTo: new Date("2026-08-31") } });
    const answer = await askQuestion(userId, { question: "כמה ריבית יש בדף הזה?", consent: false, documentId: doc.id }, null);
    expect(answer).toMatchObject({ mode: "rules", intent: "document_interest" });
    expect(answer.answer).toContain("70");
    expect(answer.facts.map((f) => f.value)).toEqual(expect.arrayContaining([100, 30]));
    expect(answer.facts).toHaveLength(2);
    await expect(askQuestion(otherId, { question: "מה היה בקובץ?", consent: false, documentId: doc.id }, null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("is a read over HTTP: CSRF-protected, strict, and absent from the activity log", async () => {
    const ok = await request(app).post("/api/household-assistant/ask").set(headers()).send({ question: "כמה הוצאתי החודש?", consent: false });
    expect(ok.status).toBe(200);
    expect(ok.body.intent).toBe("month_totals");
    expect((await request(app).post("/api/household-assistant/ask").set(headers()).send({ question: "כמה?", consent: false, userId: otherId })).status).toBe(400);
    const { "X-CSRF-Token": _csrf, ...noCsrf } = headers();
    expect((await request(app).post("/api/household-assistant/ask").set(noCsrf).send({ question: "כמה הוצאתי?", consent: false })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.activityEvent.count({ where: { userId } })).toBe(0);
  });
});
