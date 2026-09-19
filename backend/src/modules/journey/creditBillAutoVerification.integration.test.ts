import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { importSessions } from "../imports/importSession.service";
import { creditService } from "../credit/credit.service";
import { commitments } from "./commitments.service";

let userId: number; let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;

beforeAll(async () => {
  storage = await mkdtemp(path.join(os.tmpdir(), "mj-autoverify-"));
  env.DOCUMENT_STORAGE_DIR = storage;
  userId = (await prisma.user.create({ data: { name: "__autoverify_test", email: `${crypto.randomUUID()}@example.test` } })).id;
}, 30000);
afterAll(async () => {
  env.DOCUMENT_STORAGE_DIR = originalStorage;
  await rm(storage, { recursive: true, force: true });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

// Reproduces the exact real multi-month scenario from the household-journey
// validation: one real credit statement import produces several historical
// "open debt" bills with no decision. Before this fix, all of them required
// the user to resolve manually, even when the bank side already proves
// payment. This test drives the real import pipeline against the real
// fixture, then proves which bills a real bank settlement can verify
// automatically and which correctly remain for the user.
describe("credit bills are verified against bank settlement data before asking the user (P0 follow-up / G1-adjacent)", () => {
  it("imports the real multi-month credit statement and confirms it", async () => {
    const card = await prisma.creditCard.create({ data: { userId, name: "test", issuer: "test", lastFour: "1234" } });
    const buffer = await readFile(path.join(process.cwd(), "tests/fixtures/credit-statement.xlsx"));
    const session = await importSessions.create(userId, "credit-statement.xlsx", buffer, { kind: "credit", cardId: card.id });
    const committed = await importSessions.commit(userId, session.id, session.version);
    await creditService.confirmImport(userId, (committed.result as { creditImportId: number }).creditImportId);
  });

  it("resolves none of the real historical bills without any bank data -- never infers paid from the date alone", async () => {
    const rows = await commitments(userId);
    const bills = rows.filter(c => c.kind === "credit");
    expect(bills.length).toBeGreaterThanOrEqual(6); // the real fixture spans several months
    expect(bills.every(b => b.decision === null)).toBe(true);
  });

  it("auto-verifies exactly the bills a real bank settlement proves, leaves the rest for the user, and is idempotent", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    const before = (await commitments(userId)).filter(c => c.kind === "credit").sort((a, b) => a.date.localeCompare(b.date));
    expect(before.length).toBeGreaterThanOrEqual(6);

    const [verifiable1, wrongAmount, ambiguous, verifiable2] = before;

    // 1) Exact match: same card, same amount, same date -> should auto-verify.
    const payment1 = await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(verifiable1.date), amount: verifiable1.amount!, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" } });
    // 2) Wrong amount -> must NOT auto-verify.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(wrongAmount.date), amount: wrongAmount.amount! + 1, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" } });
    // 3) Ambiguous: two candidates with the same amount/date/card -> must NOT auto-verify either.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(ambiguous.date), amount: ambiguous.amount!, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(ambiguous.date), amount: ambiguous.amount!, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" } });
    // 4) Issuer-only description (no card digits), unique match -> still verifies via the existing issuer-only tolerance rule.
    const payment2 = await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(verifiable2.date), amount: verifiable2.amount!, type: "withdrawal", resolution: "credit_card_settled", description: "עפ\"י הרשאה כאל" } });

    const after = await commitments(userId);
    const byKey = new Map(after.map(c => [c.key, c]));

    expect(byKey.get(verifiable1.key)?.decision).toBe("paid");
    expect(byKey.get(verifiable2.key)?.decision).toBe("paid");
    expect(byKey.get(wrongAmount.key)?.decision).toBeNull();
    expect(byKey.get(ambiguous.key)?.decision).toBeNull();

    const decision1 = await prisma.commitmentDecision.findUniqueOrThrow({ where: { userId_eventKey: { userId, eventKey: verifiable1.key } } });
    expect(decision1.bankTransactionId).toBe(payment1.id);
    const decision2 = await prisma.commitmentDecision.findUniqueOrThrow({ where: { userId_eventKey: { userId, eventKey: verifiable2.key } } });
    expect(decision2.bankTransactionId).toBe(payment2.id);

    // Idempotent: reading again does not create a second decision or change the result.
    await commitments(userId);
    expect(await prisma.commitmentDecision.count({ where: { userId, eventKey: verifiable1.key } })).toBe(1);
    expect(await prisma.commitmentDecision.count({ where: { userId, eventKey: verifiable2.key } })).toBe(1);
  });

  it("never overrides a decision the user (or an earlier read) already made, even if a bank settlement later appears", async () => {
    const bills = (await commitments(userId)).filter(c => c.kind === "credit" && c.decision === null);
    const target = bills[0];
    expect(target).toBeTruthy();
    await prisma.commitmentDecision.create({ data: { userId, eventKey: target.key, fingerprint: target.fingerprint, decision: "unpaid", note: "המשתמשת סימנה ידנית כטרם שולם" } });

    const account = await prisma.bankAccount.findFirstOrThrow({ where: { userId } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date(target.date), amount: target.amount!, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" } });

    const after = await commitments(userId);
    expect(after.find(c => c.key === target.key)?.decision).toBe("unpaid");
  });
});
