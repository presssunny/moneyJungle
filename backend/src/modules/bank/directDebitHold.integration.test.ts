import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { monthTotals } from "../dashboard/dashboard.service";
import { reconciliationService } from "./reconciliation.service";

let userId: number;
let accountId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__direct_debit_hold_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "עו״ש" } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

const row = (description: string, lineKind: string) => ({
  userId, bankAccountId: accountId, transactionDate: new Date("2026-09-12"), description, amount: 245, type: "withdrawal", lineKind,
});

// Banker 2026-11-14: the direct-debit rule applies to new imports only until she approves re-running it on stored rows.
describe("a stored card settlement that the new rule calls a direct debit", () => {
  it("keeps its stored kind on re-resolve, so months she already saw do not move", async () => {
    await prisma.bankTransaction.create({ data: row("הרשאה לחיוב הראל ביטוח", "credit_card_payment") });
    await reconciliationService.resolveAll(userId);
    const before = await monthTotals(userId, 2026, 9);

    expect(await reconciliationService.backfillClassification(userId)).toBe(0);
    await reconciliationService.resolveAll(userId);
    const stored = await prisma.bankTransaction.findFirstOrThrow({ where: { userId } });
    expect(stored.lineKind).toBe("credit_card_payment");
    expect(await monthTotals(userId, 2026, 9)).toEqual(before);
  });

  it("still re-classifies a stored row whose kind changed for any other reason", async () => {
    await prisma.bankTransaction.create({ data: row("הלוואה - תשלום קרן 108", "standard") });
    await reconciliationService.resolveAll(userId);
    expect(await reconciliationService.backfillClassification(userId)).toBe(1);
    expect((await prisma.bankTransaction.findFirstOrThrow({ where: { userId } })).lineKind).toBe("loan_principal");
  });
});
