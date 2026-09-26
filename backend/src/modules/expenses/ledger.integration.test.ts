import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { monthTotals } from "../dashboard/dashboard.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";

let userId: number;
let otherId: number;
let token: string;
let foodId: number;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
const get = (path: string) => request(app).get(path).set(headers());

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: "__ledger", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__ledger_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  foodId = (await prisma.category.create({ data: { userId, name: "מכולת" } })).id;
  await prisma.expense.createMany({ data: Array.from({ length: 12 }, (_, i) => ({
    userId, amount: 10 + i, businessName: `חנות ${i}`, expenseDate: new Date(`2026-08-${String(i + 1).padStart(2, "0")}`),
    categoryId: i % 2 ? foodId : null, isRecurring: i === 3,
  })) });
  await prisma.expense.create({ data: { userId: otherId, amount: 999, businessName: "חנות זרה", expenseDate: new Date("2026-08-05") } });
  const confirmed = await prisma.creditImport.create({ data: { userId, fileName: "c", importMonth: 8, importYear: 2026, status: "confirmed" } });
  const draft = await prisma.creditImport.create({ data: { userId, fileName: "d", importMonth: 8, importYear: 2026, status: "pending" } });
  const row = { userId, transactionDate: new Date("2026-08-20"), billingDate: new Date("2026-08-20") };
  await prisma.creditTransaction.createMany({ data: [
    { ...row, creditImportId: confirmed.id, businessName: "ועד בית", amount: 250, transactionType: "standing_order", categoryId: foodId },
    { ...row, creditImportId: confirmed.id, businessName: "מימון", amount: 5000, transactionType: "financing" },
    { ...row, creditImportId: draft.id, businessName: "טיוטה", amount: 70 },
  ] });
  await prisma.income.createMany({ data: [
    { userId, type: "salary", amount: 9000, description: "חברה בע\"מ", incomeDate: new Date("2026-08-09"), isRecurring: true },
    { userId, type: "gift", amount: 300, description: "יום הולדת", incomeDate: new Date("2026-08-15") },
  ] });
});
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); await prisma.$disconnect(); });

describe("server-paginated expense ledger", () => {
  it("pages the merged month newest first without repeating a row, and keeps the month total from monthTotals", async () => {
    const first = await get("/api/expenses/ledger?year=2026&month=8&pageSize=10");
    const second = await get("/api/expenses/ledger?year=2026&month=8&pageSize=10&page=2");
    expect(first.status).toBe(200);
    const rows = [...first.body.items, ...second.body.items];
    expect(rows).toHaveLength(13);
    expect(new Set(rows.map((r: { source: string; id: number }) => `${r.source}:${r.id}`)).size).toBe(13);
    expect(rows[0].businessName).toBe("ועד בית");
    const totals = await monthTotals(userId, 2026, 8);
    expect(first.body).toMatchObject({ filteredCount: 13, monthCount: 13, monthTotal: totals.expenseTotal, filteredTotal: totals.expenseTotal });
    expect(JSON.stringify(rows)).not.toMatch(/מימון|טיוטה|חנות זרה/);
  });

  it("filters on the server, with the filter's own count and sum", async () => {
    const byCategoryName = await get(`/api/expenses/ledger?year=2026&month=8&q=${encodeURIComponent("מכולת")}`);
    expect(byCategoryName.body.filteredCount).toBe(7);
    expect(byCategoryName.body.filteredTotal).toBe(11 + 13 + 15 + 17 + 19 + 21 + 250);
    expect(byCategoryName.body.monthTotal).toBe((await monthTotals(userId, 2026, 8)).expenseTotal);
    expect((await get("/api/expenses/ledger?year=2026&month=8&uncat=1")).body.filteredCount).toBe(6);
    expect((await get("/api/expenses/ledger?year=2026&month=8&recurring=1")).body.items.map((r: { businessName: string }) => r.businessName).sort()).toEqual(["ועד בית", "חנות 3"]);
    expect((await get(`/api/expenses/ledger?year=2026&month=8&category=${foodId}&from=2026-08-01&to=2026-08-06`)).body.filteredCount).toBe(3);
  });

  it("rejects unknown filters", async () => {
    expect((await get("/api/expenses/ledger?year=2026&month=8&userId=1")).status).toBe(400);
    expect((await get("/api/expenses/ledger?year=2026&month=8&pageSize=1000")).status).toBe(400);
  });
});

describe("server-paginated income ledger", () => {
  it("finds incomes by their kind's name and reports the kinds and recurring count", async () => {
    const salary = await get(`/api/incomes/ledger?year=2026&month=8&q=${encodeURIComponent("משכורת")}`);
    expect(salary.body).toMatchObject({ filteredCount: 1, filteredTotal: 9000, monthTotal: 9300, monthCount: 2, recurringCount: 1 });
    const all = await get("/api/incomes/ledger?year=2026&month=8");
    expect(all.body.items.map((r: { type: string }) => r.type)).toEqual(["gift", "salary"]);
    expect(all.body.byType).toEqual(expect.arrayContaining([{ type: "salary", label: "משכורת", amount: 9000 }, { type: "gift", label: "מתנה", amount: 300 }]));
    expect((await get("/api/incomes/ledger?year=2026&month=8&type=gift")).body.filteredTotal).toBe(300);
  });
});
