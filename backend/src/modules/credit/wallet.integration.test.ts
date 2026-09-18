import crypto from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { hasFixture, readFixture } from "../../testing/fixtures";
import { parseCreditFile } from "./creditParser.service";
import { walletService } from "./wallet.service";
import { reportsService } from "../reports/reports.service";
import { creditService } from "./credit.service";
import * as XLSX from "xlsx";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";

const userIds: number[] = [];
let userId: number;
let otherId: number;
let importId: number;
let token: string;
let cardId: number;

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { name: `__test_wallet_${crypto.randomUUID()}`, email: `wallet-${crypto.randomUUID()}@example.test` } });
    userIds.push(user.id);
  }
  [userId, otherId] = userIds;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  const batch = await prisma.creditImport.create({ data: { userId, fileName: "fixture.xlsx", importMonth: 1, importYear: 2026, status: "confirmed" } });
  importId = batch.id;
  const rows = hasFixture("creditStatement") ? parseCreditFile(readFixture("creditStatement")) : [{
    transactionDate: new Date("2026-01-02"), chargeDate: new Date("2026-02-15"),
    businessName: "Synthetic CI purchase", amount: 100, paymentCount: 1, transactionType: "regular",
  }];
  await prisma.creditTransaction.createMany({ data: rows.map((row) => ({ userId, creditImportId: importId,
    billingDate: row.transactionDate, transactionDate: row.transactionDate, chargeDate: row.chargeDate,
    businessName: row.businessName, amount: row.amount, paymentCount: row.paymentCount, transactionType: row.transactionType })) });
}, 30000);
afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("wallet with real credit fixture and authenticated API", () => {
  it("reports actual confirmed import freshness, excluding pending imports and other accounts", async () => {
    const empty = await walletService.list(otherId, 2026, 1);
    expect(empty.lastConfirmedImportAt).toBeNull();
    const date = new Date("2020-02-03T00:00:00.000Z");
    await prisma.creditImport.create({ data: { userId: otherId, fileName: "old-confirmed", importMonth: 1, importYear: 2020, status: "confirmed", createdAt: date } });
    await prisma.creditImport.create({ data: { userId: otherId, fileName: "new-pending", importMonth: 1, importYear: 2026, status: "pending" } });
    const wallet = await walletService.list(otherId, 2026, 1);
    expect(wallet.lastConfirmedImportAt).toBe(date.toISOString());
    expect(wallet.updatedAt).not.toBe(wallet.lastConfirmedImportAt);
  });
  it.skipIf(!hasFixture("creditStatement"))("matches the existing monthly report for every fixture month", async () => {
    const rows = parseCreditFile(readFixture("creditStatement"));
    const keys = [...new Set(rows.map((row) => row.transactionDate.toISOString().slice(0, 7)))];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [year, month] = key.split("-").map(Number);
      const [wallet, report] = await Promise.all([walletService.list(userId, year, month), reportsService.monthly(userId, year, month)]);
      expect(wallet.all.total).toBe(report.current.expenseTotal);
      expect(wallet.unassigned.total).toBe(wallet.all.total);
    }
  });
  it("creates a card and associates the fixture without copying money rows", async () => {
    const result = await request(app).post("/api/credit/cards").set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173").send({ name: "test card", issuer: "test", lastFour: "1234", billingDay: 15 });
    expect(result.status).toBe(201); cardId = result.body.id as number;
    const count = await prisma.creditTransaction.count({ where: { userId } });
    const assigned = await request(app).patch(`/api/credit/imports/${importId}/card`).set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173").send({ cardId });
    expect(assigned.status).toBe(200);
    expect(await prisma.creditTransaction.count({ where: { userId, cardId } })).toBe(count);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  });
  it("rejects another user's card and leaves the original association intact", async () => {
    const foreign = await walletService.create(otherId, { name: "foreign", issuer: "test", lastFour: "9999" });
    const response = await request(app).patch(`/api/credit/imports/${importId}/card`).set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173").send({ cardId: foreign.id });
    expect(response.status).toBe(404);
    expect(await prisma.creditTransaction.count({ where: { userId, cardId: foreign.id } })).toBe(0);
    await expect(walletService.assign(otherId, importId, foreign.id)).rejects.toThrow();
    const transaction = await prisma.creditTransaction.findFirstOrThrow({ where: { userId } });
    await expect(walletService.assignTransaction(otherId, transaction.id, foreign.id)).rejects.toThrow();
  });
  it("validates card identity and scenario input", async () => {
    const invalidCard = await request(app).post("/api/credit/cards").set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173").send({ name: "test", issuer: "test", lastFour: "1234567890123456" });
    expect(invalidCard.status).toBe(400);
    const invalidForecast = await request(app).get("/api/reports/forecast?oneTimeMonth=13").set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173");
    expect(invalidForecast.status).toBe(400);
  });
  it("returns a 12-month forecast through the authenticated route", async () => {
    const response = await request(app).get("/api/reports/forecast").set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173");
    expect(response.status).toBe(200);
    expect(response.body.months).toHaveLength(12);
    expect(response.body.annualBalance).toBeNull();
  });
  it("does not expose pending imports or another user's transactions", async () => {
    const pending = await prisma.creditImport.create({ data: { userId, fileName: "pending", importMonth: 1, importYear: 2026 } });
    await prisma.creditTransaction.create({ data: { userId, creditImportId: pending.id, businessName: "pending", billingDate: new Date("2026-01-01"), transactionDate: new Date("2026-01-01"), amount: 999999 } });
    const wallet = await walletService.list(userId, 2026, 1);
    expect(wallet.pendingCount).toBe(1);
    expect(wallet.all.transactions.some((row) => row.businessName === "pending")).toBe(false);
    const other = await walletService.list(otherId, 2026, 1);
    expect(other.all.transactions).toHaveLength(0);
  });
  it("allows identical purchases on distinct cards but refuses a repeated file", async () => {
    const cardA = await walletService.create(userId, { name: "A", issuer: "test", lastFour: "1111" });
    const cardB = await walletService.create(userId, { name: "B", issuer: "test", lastFour: "2222" });
    const statement = (sheetName: string): Buffer => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["תאריך עסקה", "שם בית עסק", "סכום חיוב"], ["01/01/2026", "Unique wallet purchase", 12.34]]), sheetName);
      return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    };
    const first = await creditService.createImport(userId, "A.xlsx", statement("A"), { cardId: cardA.id });
    const second = await creditService.createImport(userId, "B.xlsx", statement("B"), { cardId: cardB.id });
    expect(first.alreadyImported).toBe(false);
    expect(second.alreadyImported).toBe(false);
    const repeated = await creditService.createImport(userId, "copy.xlsx", statement("A"), { cardId: cardB.id });
    expect(repeated.alreadyImported).toBe(true);
    expect(await prisma.creditTransaction.count({ where: { userId, businessName: "Unique wallet purchase" } })).toBe(2);
  });
  it("requires resolution of unassigned overlaps before a card-specific import", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["תאריך עסקה", "שם בית עסק", "סכום חיוב"], ["01/01/2026", "unassigned overlap", 4]]), "rows");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await prisma.creditTransaction.create({ data: { userId, creditImportId: importId, businessName: "unassigned overlap", billingDate: new Date("2026-01-01"), transactionDate: new Date("2026-01-01"), amount: 4 } });
    await expect(creditService.createImport(userId, "overlap.xlsx", buffer, { cardId })).rejects.toThrow("שייכו קודם");
    expect(await prisma.creditTransaction.count({ where: { userId, businessName: "unassigned overlap" } })).toBe(1);
  });
  it("edits owned card details and refuses another account", async () => {
    const details = { name: "updated", issuer: "test", lastFour: "4321", billingDay: 28 };
    const response = await request(app).patch(`/api/credit/cards/${cardId}`).set("Cookie", `${sessionCookieName}=${token}`).set("X-CSRF-Token", csrfForSession(token)).set("Origin", "http://localhost:5173").send(details);
    expect(response.status).toBe(200);
    await expect(walletService.update(otherId, cardId, details)).rejects.toThrow();
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).name).toBe("updated");
  });
});

