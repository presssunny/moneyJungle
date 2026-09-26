import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { savingsService } from "./savings.service";

let userId: number;
let otherId: number;
let token: string;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
const loan = (owner: number, balance: number) => prisma.loan.create({ data: {
  userId: owner, loanName: "הלוואת רכב", loanType: "car", originalAmount: 50000, currentBalance: balance,
  annualInterestRate: 5, monthlyPayment: 1000, startDate: new Date("2025-01-01"),
} });

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__goals", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__goals_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("goals", () => {
  it("keeps the saved amount when an edit leaves it out", async () => {
    const created = await request(app).post("/api/savings").set(headers()).send({ goalName: "חופשה", targetAmount: 5000, currentAmount: 1200 });
    expect(created.status).toBe(201);
    const renamed = await request(app).patch(`/api/savings/${created.body.id}`).set(headers()).send({ goalName: "חופשה באילת" });
    expect(renamed.status).toBe(200);
    expect(Number(renamed.body.currentAmount)).toBe(1200);
  });

  it("reads a payoff goal's progress from the loan balance, never from deposits", async () => {
    const car = await loan(userId, 20000);
    const created = await request(app).post("/api/savings").set(headers()).send({ goalName: "לסגור את הרכב", goalType: "debt_payoff", loanId: car.id, targetAmount: 1 });
    expect(created.status).toBe(201);
    expect(created.body.progress).toMatchObject({ target: 20000, current: 0, remaining: 20000, source: "loan" });

    await prisma.loan.update({ where: { id: car.id }, data: { currentBalance: 15000 } });
    let goal = (await savingsService.list(userId)).goals[0];
    expect(goal.progress).toMatchObject({ current: 5000, remaining: 15000, percent: 25, complete: false });

    // Interest or indexation can push the balance above where it started: no progress, never negative.
    await prisma.loan.update({ where: { id: car.id }, data: { currentBalance: 21000 } });
    expect((await savingsService.list(userId)).goals[0].progress).toMatchObject({ current: 0, remaining: 20000 });

    expect((await request(app).post(`/api/savings/${created.body.id}/deposit`).set(headers()).send({ amount: 500 })).status).toBe(400);
    expect((await request(app).patch(`/api/savings/${created.body.id}`).set(headers()).send({ currentAmount: 500 })).status).toBe(400);

    await prisma.loan.update({ where: { id: car.id }, data: { status: "finished" } });
    expect((await savingsService.list(userId)).goals[0].progress).toMatchObject({ current: 20000, remaining: 0, complete: true });

    await prisma.loan.delete({ where: { id: car.id } });
    goal = (await savingsService.list(userId)).goals[0];
    expect(goal.progress.source).toBe("unavailable");
    expect(goal.progress.complete).toBe(false);
  });

  it("counts only money set aside in the savings summary", async () => {
    const car = await loan(userId, 20000);
    await savingsService.create(userId, { goalName: "קרן חירום", goalType: "savings", targetAmount: 10000, currentAmount: 4000 });
    await savingsService.create(userId, { goalName: "מקרר", goalType: "purchase", targetAmount: 6000, currentAmount: 1000 });
    await savingsService.create(userId, { goalName: "רכב", goalType: "debt_payoff", loanId: car.id, currentAmount: 0 });
    await prisma.loan.update({ where: { id: car.id }, data: { currentBalance: 10000 } });
    const { summary, goals } = await savingsService.list(userId);
    expect(goals).toHaveLength(3);
    expect(summary).toEqual({ savedTotal: 5000, targetTotal: 16000, setAsideCount: 2, completion: 31 });
  });

  it("refuses a payoff goal on another owner's loan or a closed one", async () => {
    const foreign = await loan(otherId, 9000);
    expect((await request(app).post("/api/savings").set(headers()).send({ goalName: "x", goalType: "debt_payoff", loanId: foreign.id })).status).toBe(400);
    const closed = await prisma.loan.update({ where: { id: (await loan(userId, 0)).id }, data: { status: "finished" } });
    expect((await request(app).post("/api/savings").set(headers()).send({ goalName: "x", goalType: "debt_payoff", loanId: closed.id })).status).toBe(400);
    expect((await request(app).post("/api/savings").set(headers()).send({ goalName: "x", goalType: "debt_payoff" })).status).toBe(400);
  });
});
