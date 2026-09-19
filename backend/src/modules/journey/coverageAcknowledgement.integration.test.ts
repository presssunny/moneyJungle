import crypto from "node:crypto";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";

let userId: number; let token: string;
beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: "__coverage_ack_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
}, 30000);
afterAll(async () => { if (userId) await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); });
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });

describe("real coverage acknowledgement gates onboarding completion (P0.2 / G3)", () => {
  it("declares a manual-only, no-activity scope so completion needs only a real coverage ack", async () => {
    const saved = await request(app).patch("/api/journey/profile").set(headers()).send({ scope: { accountsListed: true, cardsListed: true, commitmentsListed: true, manualOnly: true } });
    expect(saved.status).toBe(200);
  });

  it("rejects a stale dataVersion sent to the coverage endpoint itself", async () => {
    const bad = await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: "0".repeat(64), confirmed: true, sourceKeys: [] });
    expect(bad.status).toBe(409);
  });

  it("financial data changing after acknowledgement makes the acknowledgement stale and re-blocks completion", async () => {
    const status1 = await request(app).get("/api/journey/status").set(headers());
    const ack1 = await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: status1.body.dataVersion, confirmed: true, sourceKeys: status1.body.sources.map((s: { key: string }) => s.key) });
    expect(ack1.status).toBe(200);
    const done1 = await request(app).post("/api/journey/onboarding/complete").set(headers()).send({ reviewed: true, noActivity: true });
    expect(done1.status).toBe(200);
    expect(done1.body.onboarding).toBe("completed");

    // Onboarding is already completed and stays completed; a later coverage
    // check is what the daily allowance depends on, and it must reflect the
    // new expense, not the stale acknowledgement recorded before it existed.
    await prisma.expense.create({ data: { userId, amount: 5, expenseDate: new Date() } });
    const status2 = await request(app).get("/api/journey/status").set(headers());
    expect(status2.body.dataVersion).not.toBe(status1.body.dataVersion);
    expect(status2.body.coverageAcknowledged).toBe(false);

    const staleAck = await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: status1.body.dataVersion, confirmed: true, sourceKeys: status1.body.sources.map((s: { key: string }) => s.key) });
    expect(staleAck.status).toBe(409);

    const ack2 = await request(app).post("/api/journey/coverage").set(headers()).send({ dataVersion: status2.body.dataVersion, confirmed: true, sourceKeys: status2.body.sources.map((s: { key: string }) => s.key) });
    expect(ack2.status).toBe(200);
    const status3 = await request(app).get("/api/journey/status").set(headers());
    expect(status3.body.coverageAcknowledged).toBe(true);
  });
});
