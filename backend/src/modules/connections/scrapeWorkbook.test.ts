import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBankStatement } from "../bank/bankParser.service";
import { parseCreditFile } from "../credit/creditParser.service";
import { parseLoanSchedule } from "../loans/loanSchedule.parser";
import type { ScrapedLoan, ScrapedTransaction } from "../../types/connections.types";
import { STUB_LOAN } from "../../testing/scraperStub";
import { STUB_LOAN_DIGITS, STUB_LOANS_TRACKS } from "../../testing/fakeLoanDetails";
import { bankWorkbook, cardWorkbook, FOREIGN_LIST_CAP, freshTransactions, israelDay, loanScheduleWorkbook, purchaseDay } from "./scrapeWorkbook";

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
    expect(result.foreign).toEqual([
      { date: "2026-10-01", description: "DOLLAR CARD", originalAmount: -20, originalCurrency: "USD", chargedAmount: -20, chargedCurrency: "USD" },
      { date: "2026-10-01", description: "UNSTATED", originalAmount: -20, originalCurrency: "GBP", chargedAmount: null, chargedCurrency: null },
    ]);
    expect(parseCreditFile(result.buffer).map((r) => [r.businessName, r.amount])).toEqual([["AMAZON", 74.3]]);
  });
});

describe("unstated billing currency (Max)", () => {
  it("imports a shekel purchase the card did not label, and keeps a foreign one out, listed", () => {
    const result = cardWorkbook([
      txn({ chargedCurrency: undefined, originalCurrency: "ILS", description: "סופר שקלי" }),
      txn({ chargedCurrency: undefined, originalCurrency: "EUR", originalAmount: -15, description: "PARIS" }),
    ]);
    expect(parseCreditFile(result.buffer).map((r) => r.businessName)).toEqual(["סופר שקלי"]);
    expect(result.foreign.map((f) => f.description)).toEqual(["PARIS"]);
  });

  it("lists at most FOREIGN_LIST_CAP foreign rows but counts them all", () => {
    const result = cardWorkbook(Array.from({ length: FOREIGN_LIST_CAP + 5 }, (_, i) => txn({ chargedCurrency: "USD", description: `F${i}` })));
    expect(result.skippedForeign).toBe(FOREIGN_LIST_CAP + 5);
    expect(result.foreign).toHaveLength(FOREIGN_LIST_CAP);
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

describe("loanScheduleWorkbook → schedule parser", () => {
  const built = (loan: ScrapedLoan) => {
    const workbook = loanScheduleWorkbook(loan);
    if ("skip" in workbook) throw new Error(`skipped: ${workbook.skip}`);
    return workbook;
  };

  it("round-trips a track: its numbers, its rows, and Σ principal = the balance", () => {
    const parsed = parseLoanSchedule(built(STUB_LOAN_DIGITS).buffer);
    expect(parsed).toMatchObject({ loanNumber: "90001", trackNumber: "301", trackName: "הלוואה לדוגמה", currentBalance: 3000, paymentsMade: 3, totalPayments: 6 });
    expect(parsed.rows).toEqual(STUB_LOAN_DIGITS.schedule.map((row) => ({
      paymentNumber: row.paymentNumber, paymentDate: row.date, principal: row.principal, interest: row.interest, total: row.total, balanceAfter: row.balanceAfter,
    })));
    expect(parsed.checks.principalSumMatchesBalance).toBe(true);
    expect(parsed.checks.principalSum).toBe(STUB_LOAN_DIGITS.principalBalance);
  });

  it("dates the file by the bank's asOf, never today, so the same loan is the same bytes", () => {
    expect(parseLoanSchedule(built(STUB_LOAN_DIGITS).buffer).exportedAt).toBe("2026-10-31");
    const hash = (loan: ScrapedLoan) => crypto.createHash("sha256").update(built(loan).buffer).digest("hex");
    expect(hash(STUB_LOAN_DIGITS)).toBe(hash(structuredClone(STUB_LOAN_DIGITS)));
    expect(hash({ ...STUB_LOAN_DIGITS, asOf: "2026-11-30" })).not.toBe(hash(STUB_LOAN_DIGITS));
  });

  it("keeps each track of a loan apart", () => {
    expect(STUB_LOANS_TRACKS.map((loan) => { const p = parseLoanSchedule(built(loan).buffer); return [p.loanNumber, p.trackNumber, p.currentBalance]; }))
      .toEqual(STUB_LOANS_TRACKS.map((loan) => [loan.loanNumber, loan.trackNumber, loan.principalBalance]));
  });

  // The parser's header regexes are \d+; CPI linkage has no column there and needs banker sign-off (§5).
  it.each<[string, ScrapedLoan, string]>([
    ["a loan number with letters", STUB_LOAN as ScrapedLoan, "IDENTIFIER_UNREADABLE"],
    ["no track number", { ...STUB_LOAN_DIGITS, trackNumber: null }, "IDENTIFIER_UNREADABLE"],
    ["a snapshot with no rows", { ...STUB_LOAN_DIGITS, schedule: [] }, "NO_SCHEDULE"],
    ["a row the bank left without interest", { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, interest: null })) }, "SCHEDULE_INCOMPLETE"],
    ["a row without principal", { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, principal: null })) }, "SCHEDULE_INCOMPLETE"],
    ["a row without the balance after it", { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, balanceAfter: null })) }, "SCHEDULE_INCOMPLETE"],
    ["a linkage difference", { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, linkage: 3.2 })) }, "INDEX_LINKED"],
    ["a CPI-linked track", { ...STUB_LOAN_DIGITS, indexLinked: true }, "INDEX_LINKED"],
  ])("skips %s instead of building a file", (_case, loan, skip) => {
    expect(loanScheduleWorkbook(loan)).toEqual({ skip });
  });

  it("builds a track whose linkage the bank left blank or printed as zero", () => {
    for (const linkage of [null, 0]) {
      const loan = { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r) => ({ ...r, linkage })) };
      expect(parseLoanSchedule(built(loan).buffer).rows).toHaveLength(3);
    }
  });
});
