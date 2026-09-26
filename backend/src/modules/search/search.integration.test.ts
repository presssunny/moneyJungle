import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";

let userId: number;
let otherId: number;
let token: string;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__search", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__search_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  await prisma.expense.create({ data: { userId, amount: 42.5, businessName: "מאפיית השכונה", expenseDate: new Date("2026-09-10") } });
  await prisma.expense.create({ data: { userId: otherId, amount: 99, businessName: "מאפיית השכנים", expenseDate: new Date("2026-09-10") } });
  const draft = await prisma.creditImport.create({ data: { userId, fileName: "d", importMonth: 9, importYear: 2026, status: "pending" } });
  await prisma.creditTransaction.create({ data: { userId, creditImportId: draft.id, businessName: "מאפיית השכונה", amount: 18, transactionDate: new Date("2026-09-11"), billingDate: new Date("2026-09-11") } });
});
afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("record search", () => {
  it("finds the owner's records by name, with links, and never another account's", async () => {
    const res = await request(app).get(`/api/search?q=${encodeURIComponent("מאפיית")}`).set(headers());
    expect(res.status).toBe(200);
    const kinds = res.body.groups.map((g: { kind: string }) => g.kind);
    expect(kinds).toEqual(["expenses", "credit"]);
    expect(res.body.groups[0].items).toEqual([expect.objectContaining({ label: "מאפיית השכונה", amount: 42.5, date: "2026-09-10", to: expect.stringContaining("/transactions?tab=expenses&month=2026-09") })]);
    expect(res.body.groups[1].items[0].detail).toBe("בדוח שטרם אושר");
    expect(JSON.stringify(res.body)).not.toContain("השכנים");
  });

  it("rejects one-letter and unknown query parameters", async () => {
    expect((await request(app).get("/api/search?q=a").set(headers())).status).toBe(400);
    expect((await request(app).get("/api/search?q=abc&userId=2").set(headers())).status).toBe(400);
  });
});
