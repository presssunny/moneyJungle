import { describe, expect, it } from "vitest";
import { parseBankStatement } from "../bank/bankParser.service";
import { parseCreditFile } from "../credit/creditParser.service";
import type { ScrapedTransaction } from "../../types/connections.types";
import { bankWorkbook, cardWorkbook, freshTransactions, israelDay, purchaseDay } from "./scrapeWorkbook";

const txn = (overrides: Partial<ScrapedTransaction>): ScrapedTransaction => ({
  type: "normal", date: "2026-09-30T21:00:00.000Z", processedDate: "2026-11-01T22:00:00.000Z",
  originalAmount: -100, originalCurrency: "ILS", chargedAmount: -100, chargedCurrency: "ILS", description: "סופר", status: "completed", ...overrides,
});
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("israelDay", () => {
  it("reads the scraper's UTC timestamp as the Israeli calendar day", () => {
    expect(israelDay("2026-09-30T21:00:00.000Z")).toBe("2026-10-01");
    expect(israelDay("2026-01-14T22:00:00.000Z")).toBe("2026-01-15");
  });
});

describe("bankWorkbook → bank parser", () => {
  it("puts money out in חובה and money in in זכות by the charged sign, not the text", () => {
    const { buffer, rows } = bankWorkbook([
      txn({ description: "החזר הלוואה", chargedAmount: -1250.5 }),
      txn({ description: "משכורת", chargedAmount: 7000, date: "2026-10-09T21:00:00.000Z" }),
      txn({ description: "זיכוי מכאל", chargedAmount: -40 }),
    ]);
    expect(rows).toBe(3);
    const parsed = parseBankStatement(buffer).rows;
    expect(parsed.map((r) => [day(r.date), r.description, r.type, r.amount])).toEqual([
      ["2026-10-01", "החזר הלוואה", "withdrawal", 1250.5],
      ["2026-10-10", "משכורת", "deposit", 7000],
      ["2026-10-01", "זיכוי מכאל", "withdrawal", 40],
    ]);
  });

  it("leaves pending and foreign-currency rows out, and counts them", () => {
    const result = bankWorkbook([
      txn({}),
      txn({ status: "pending", description: "בהמתנה" }),
      txn({ chargedCurrency: "USD", description: "דולר" }),
      txn({ chargedAmount: 0, description: "אפס" }),
    ]);
    expect(result).toMatchObject({ rows: 1, skippedPending: 1, skippedForeign: 1 });
    expect(parseBankStatement(result.buffer).rows.map((r) => r.description)).toEqual(["סופר"]);
  });
});

describe("cardWorkbook → credit parser", () => {
  it("keeps the purchase day as the transaction date and the processed day as the charge date", () => {
    const [row] = parseCreditFile(cardWorkbook([txn({ chargedAmount: -89.9 })]).buffer);
    expect(row).toMatchObject({ businessName: "סופר", amount: 89.9, paymentCount: 1, installmentNumber: null, transactionType: "regular" });
    expect([day(row.transactionDate), day(row.chargeDate)]).toEqual(["2026-10-01", "2026-11-02"]);
  });

  it("tells instalment 4/12 apart, dates it at the purchase like the statement does, and turns a refund negative", () => {
    // The library hands instalment 4 of a 01/07 purchase back dated 01/10.
    const parsed = parseCreditFile(cardWorkbook([
      txn({ type: "installments", installments: { number: 4, total: 12 }, chargedAmount: -250, originalAmount: -3000, date: "2026-09-30T21:00:00.000Z" }),
      txn({ description: "זיכוי חנות", chargedAmount: 60 }),
    ]).buffer);
    expect(day(parsed[0].transactionDate)).toBe("2026-07-01");
    expect(parsed.map((r) => [r.amount, r.paymentCount, r.installmentNumber, r.transactionType])).toEqual([
      [250, 12, 4, "credit"],
      [-60, 1, null, "refund"],
    ]);
  });

  it("charges a foreign purchase only when the card billed it in shekels", () => {
    const result = cardWorkbook([
      txn({ originalCurrency: "USD", originalAmount: -20, chargedAmount: -74.3, chargedCurrency: "ILS", description: "AMAZON" }),
      txn({ originalCurrency: "USD", originalAmount: -20, chargedAmount: -20, chargedCurrency: "USD", description: "DOLLAR CARD" }),
      txn({ originalCurrency: "GBP", originalAmount: -20, chargedAmount: -20, chargedCurrency: undefined, description: "UNSTATED" }),
    ]);
    expect(result).toMatchObject({ rows: 1, skippedForeign: 2 });
    expect(parseCreditFile(result.buffer).map((r) => [r.businessName, r.amount])).toEqual([["AMAZON", 74.3]]);
  });
});

describe("purchaseDay", () => {
  it("undoes the library's month shift, clamping only where the month is shorter", () => {
    expect(purchaseDay(txn({ installments: { number: 1, total: 3 }, date: "2026-03-14T22:00:00.000Z" }))).toBe("2026-03-15");
    expect(purchaseDay(txn({ installments: { number: 3, total: 3 }, date: "2026-05-14T21:00:00.000Z" }))).toBe("2026-03-15");
    expect(purchaseDay(txn({ installments: { number: 2, total: 3 }, date: "2026-02-27T22:00:00.000Z" }))).toBe("2026-01-28");
  });
});

describe("freshTransactions", () => {
  it("keeps what the target has not stored and passes pending rows through to be carried", () => {
    const isNew = (t: ScrapedTransaction) => israelDay(t.date) > "2026-10-05";
    const rows = [
      txn({ description: "ישן", date: "2026-09-01T21:00:00.000Z" }),
      txn({ description: "חדש", date: "2026-10-09T21:00:00.000Z" }),
      txn({ description: "עדיין בקליטה", status: "pending", date: "2026-09-20T21:00:00.000Z" }),
    ];
    expect(freshTransactions(rows, isNew).map((t) => t.description)).toEqual(["חדש", "עדיין בקליטה"]);
    expect(bankWorkbook(freshTransactions(rows, isNew)).pending).toEqual([{ date: "2026-09-21", description: "עדיין בקליטה", amount: -100 }]);
  });
});
