import { describe, expect, it, vi } from "vitest";
vi.mock("../../config/database", () => ({ prisma: {} }));
import { summarizeWallet } from "./wallet.service";
import type { WalletTransaction } from "../../types/planning.types";

function row(id: number, amount: number, changes: Partial<WalletTransaction> = {}): WalletTransaction {
  return { id, amount, cardId: null, businessName: "store", billingDate: "2026-08-20", transactionDate: "2026-08-20", chargeDate: "2026-09-15", categoryName: "food", transactionType: "regular", paymentCount: 1, ...changes };
}
describe("wallet financial summaries", () => {
  it("attributes spend to billingDate but upcoming charges to chargeDate", () => {
    const summary = summarizeWallet([row(1, 120)], "2026-08", "2026-07", "2026-09-01");
    expect(summary.total).toBe(120);
    expect(summary.nextCharge).toEqual({ date: "2026-09-15", amount: 120 });
    expect(summary.previousTotal).toBeNull();
  });
  it("nets refunds and excludes financing, including future charges", () => {
    const summary = summarizeWallet([row(1, 120), row(2, -20, { transactionType: "refund" }), row(3, 800, { transactionType: "financing" })], "2026-08", "2026-07", "2026-09-01");
    expect(summary.total).toBe(100);
    expect(summary.nextCharge?.amount).toBe(100);
    expect(summary.financingTotal).toBe(800);
    expect(summary.categories).toEqual([{ name: "food", amount: 100 }]);
  });
  it("does not invent a charge date or future installments", () => {
    const summary = summarizeWallet([row(1, 120, { chargeDate: null, paymentCount: 12 })], "2026-08", "2026-07", "2026-09-01");
    expect(summary.total).toBe(120);
    expect(summary.nextCharge).toBeNull();
  });
  it("rounds currency and compares only available months", () => {
    const summary = summarizeWallet([row(1, 0.1), row(2, 0.2), row(3, 1, { billingDate: "2026-07-20", chargeDate: "2026-08-15" })], "2026-08", "2026-07", "2026-09-01");
    expect(summary.total).toBe(0.3);
    expect(summary.delta).toBe(-0.7);
    expect(summary.nextCharge?.amount).toBe(0.3);
  });
});
