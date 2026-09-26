import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { describeMutation } from "./activity.service";

let userId: number;
let otherId: number;
let token: string;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
// The log is written after the response; give the finish handler its turn.
const settle = async () => { for (let i = 0; i < 20 && !(await prisma.activityEvent.count({ where: { userId } })); i++) await new Promise((r) => setTimeout(r, 25)); };

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__activity", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__activity_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("activity log", () => {
  it("records a created expense with its name and amount, visible only to its owner", async () => {
    const created = await request(app).post("/api/expenses").set(headers()).send({ amount: 18, businessName: "קפה", expenseDate: "2026-09-20" });
    expect(created.status).toBe(201);
    await settle();
    const log = await request(app).get("/api/activity").set(headers());
    expect(log.status).toBe(200);
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0]).toMatchObject({ domain: "expenses", action: "create", entityId: String(created.body.id) });
    expect(log.body.items[0].summary).toContain("קפה");
    expect(log.body.items[0].summary).toContain("18");
    expect(await prisma.activityEvent.count({ where: { userId: otherId } })).toBe(0);
  });

  it("does not record rejected requests or reads", async () => {
    expect((await request(app).post("/api/expenses").set(headers()).send({ amount: -1, expenseDate: "2026-09-20" })).status).toBe(400);
    expect((await request(app).get("/api/expenses").set(headers())).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.activityEvent.count({ where: { userId } })).toBe(0);
  });

  it("pages newest first and refuses another owner's cursor", async () => {
    await prisma.activityEvent.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ userId, domain: "expenses", action: "create", summary: `row ${i}`, route: "POST /expenses" })) });
    const foreign = await prisma.activityEvent.create({ data: { userId: otherId, domain: "expenses", action: "create", summary: "x", route: "POST /expenses" } });
    const first = await request(app).get("/api/activity").set(headers());
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].summary).toBe("row 54");
    const second = await request(app).get(`/api/activity?before=${first.body.nextCursor}`).set(headers());
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    expect((await request(app).get(`/api/activity?before=${foreign.id}`).set(headers())).status).toBe(404);
  });
});

describe("describeMutation", () => {
  it("names suffix actions and hides ids of the route template", () => {
    expect(describeMutation("POST", "/imports/sessions/0b0c9f5e-8d0a-4a8e-9a55-0d9b8f1f0a11/commit", {}, { fileName: "report.xlsx" }))
      .toMatchObject({ domain: "imports", action: "commit", route: "POST /imports/sessions/:id/commit", summary: "ייבוא — נקלט: report.xlsx" });
    expect(describeMutation("DELETE", "/loans/12", undefined, { ok: true })).toMatchObject({ action: "delete", entityId: "12", summary: "הלוואה — נמחק (#12)" });
  });

  it("ignores reading marks, appearance changes, assistant planning and login", () => {
    expect(describeMutation("PATCH", "/alerts/4/read", {}, {})).toBeNull();
    expect(describeMutation("PATCH", "/settings", { theme: "dark" }, {})).toBeNull();
    expect(describeMutation("PATCH", "/settings", { monthlyBudget: 100 }, {})).not.toBeNull();
    expect(describeMutation("POST", "/household-assistant/plan", {}, {})).toBeNull();
    expect(describeMutation("POST", "/gate/login", {}, {})).toBeNull();
    expect(describeMutation("GET", "/expenses", {}, {})).toBeNull();
  });
});
