import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBankStatement, parseBankStatementPdf, type ParsedBankRow } from "./bankParser.service";
import { detectStatementCommitments } from "./statementCommitments.detector";
import type { StatementDebit } from "../../types/commitments.types";
import { fixturePath, hasFixture } from "../../testing/fixtures";

const debit = (date: string, description: string, amount: number, lineKind = "standard", loanRef: string | null = null): StatementDebit =>
  ({ date: new Date(`${date}T00:00:00Z`), description, amount, lineKind, loanRef });
const END = new Date("2026-07-20T00:00:00Z");
const months = ["2026-05", "2026-06", "2026-07"];

describe("detectStatementCommitments", () => {
  it("offers a debit repeated monthly at its latest amount, and nothing that varies", () => {
    const rows = [
      ...["2026-02", "2026-03", "2026-04"].map((m) => debit(`${m}-15`, "ביטוח ישיר", 487)),
      ...["2026-06", "2026-07"].map((m) => debit(`${m}-15`, "ביטוח  ישיר.", 129)),
      ...months.map((m, i) => debit(`${m}-03`, "כספומט ב 7468234", 500 + i)),
      ...months.map((m, i) => debit(`${m}-0${4 + i}`, "העברה מהחשבון", [70, 2600, 30][i])),
    ];
    const found = detectStatementCommitments(rows, END);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "recurring", amount: 129, months: 2, nextDate: "2026-08-15" });
  });

  it("never offers a card settlement — the card statement itemizes it", () => {
    const rows = months.flatMap((m) => [debit(`${m}-15`, "כרטיסי אשראי לי - 2349", 3000), debit(`${m}-10`, 'עפ"י הרשאה כאל', 1654)]);
    expect(detectStatementCommitments(rows, END)).toEqual([]);
  });

  it("tracks a cheque by amount, ignoring the cheque number and a one-off cheque the same day", () => {
    const rows = [...months.map((m, i) => debit(`${m}-15`, `משיכת שיק ${1000001 + i}`, 4500)), debit("2026-07-15", "משיכת שיק 1000099", 250.4)];
    const found = detectStatementCommitments(rows, END);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "recurring", name: "משיכת שיק", amount: 4500, months: 3 });
  });

  it("drops a series whose next debit was due inside the statement", () => {
    const rows = ["2026-03", "2026-04", "2026-05"].map((m) => debit(`${m}-10`, "חוג שחייה", 300));
    expect(detectStatementCommitments(rows, END)).toEqual([]);
  });

  it("keeps two loan payment days apart and prices each at its latest month's full debit", () => {
    const rows = months.flatMap((m) => [
      debit(`${m}-15`, "הלוואה - תשלום קרן 108", 900, "loan_principal", "108"),
      debit(`${m}-15`, "הלוואה - תשלום ריבית 01040", 300, "loan_interest", "01040"),
      debit(`${m}-19`, "הלוואה - תשלום קרן 108", 1700, "loan_principal", "108"),
      debit(`${m}-19`, "ריבית על הלוואה 28/05 00990", 250, "loan_interest", "00990"),
    ]);
    rows.push(debit("2026-07-15", "הלוואה - תשלום ריבית 00965", 50, "loan_interest", "00965"));
    const loans = detectStatementCommitments(rows, END).filter((c) => c.kind === "loan");
    expect(loans.map((l) => [l.key, l.amount, l.loanNumber])).toEqual([["loan:108:19", 1950, "108"], ["loan:108:15", 1250, "108"]]);
  });

  it("does not take an early payoff for an instalment, nor a stopped track for a live loan", () => {
    const rows = [
      ...["2026-03", "2026-04"].map((m) => debit(`${m}-19`, "הלוואה - תשלום קרן 108", 1700, "loan_principal", "108")),
      debit("2026-05-06", "הלוואה - תשלום קרן 108", 26189.3, "loan_principal", "108"),
      debit("2026-05-06", "ע. פרעון מוקדם", 60, "loan_fee"),
    ];
    expect(detectStatementCommitments(rows, END)).toEqual([]);
  });
});

async function parse(name: "bankStatementH1" | "bankStatementDailyPdf") {
  const file = fixturePath(name);
  const buffer = readFileSync(file);
  return file.endsWith(".pdf") ? parseBankStatementPdf(buffer) : parseBankStatement(buffer);
}

const toDebits = (rows: ParsedBankRow[]) => rows.filter((r) => r.type === "withdrawal").map((r) => ({ date: r.date, description: r.description, amount: r.amount, lineKind: r.lineKind, loanRef: r.loanRef }));

for (const name of ["bankStatementH1", "bankStatementDailyPdf"] as const) {
  describe.skipIf(!hasFixture(name))(`real statement commitments — ${name}`, () => {
    it("finds one live loan and fixed debits, never card settlements or cash", async () => {
      const { rows } = await parse(name);
      const end = new Date(Math.max(...rows.map((r) => r.date.getTime())));
      const found = detectStatementCommitments(toDebits(rows), end);
      const loans = found.filter((c) => c.kind === "loan");
      expect(loans).toHaveLength(1);
      // The offered payment is exactly the loan debits of its latest day.
      const lastDay = rows.filter((r) => r.type === "withdrawal" && ["loan_principal", "loan_interest", "loan_mixed"].includes(r.lineKind) && r.date.toISOString().slice(0, 10) === loans[0].lastDate);
      expect(loans[0].amount).toBeCloseTo(lastDay.reduce((s, r) => s + r.amount, 0), 2);
      expect(found.filter((c) => c.kind === "recurring").length).toBeGreaterThanOrEqual(2);
      expect(found.some((c) => /כרטיס|הרשאה|כספומט|בנקט/.test(c.name))).toBe(false);
      for (const c of found) expect(new Date(c.nextDate).getTime()).toBeGreaterThan(end.getTime());
    });
  });
}
