import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { updateBankAccountSchema } from "./bank.validation";

let userId: number;
let token: string;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__bank_accounts_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("editing a bank account", () => {
  it("an edit that does not mention the opening balance leaves it alone", async () => {
    expect(updateBankAccountSchema.parse({ accountName: "עו״ש משפחתי" })).toEqual({ accountName: "עו״ש משפחתי" });
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש", initialBalance: 5000 } });
    const res = await request(app).patch(`/api/bank/accounts/${account.id}`).set(headers()).send({ accountName: "עו״ש משפחתי" });
    expect(res.status).toBe(200);
    const after = await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.accountName).toBe("עו״ש משפחתי");
    expect(Number(after.initialBalance)).toBe(5000);
  });
});

describe("a fixed payment is a forecast, never an expense", () => {
  it("there is no way to write this month's fixed payments as expenses", async () => {
    await prisma.recurringPayment.create({ data: { userId, name: "שכר דירה", amount: 4500, frequency: "monthly", nextPaymentDate: new Date("2026-10-10") } });
    const res = await request(app).post("/api/recurring/generate").set(headers()).send({ year: 2026, month: 10 });
    expect(res.status).toBe(404);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  });
});
