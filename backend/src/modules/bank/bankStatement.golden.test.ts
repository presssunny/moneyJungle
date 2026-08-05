/**
 * The bank statement parsers, verified against the real exports on disk, in two
 * layers: invariants that hold for any statement and carry no figure from the
 * account (balance replay, bucket partition), and a git-ignored golden snapshot
 * for numeric drift the invariants let through — a row moving from spending to
 * financing keeps both sums balanced but changes what the dashboard reports.
 *
 * Without fixtures the suites skip. See tests/fixtures/README.md.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { hasFixture, readFixture } from "../../testing/fixtures";
import { hasGolden, readGolden } from "../../testing/golden";
import { bankGolden } from "../../testing/goldenShape";
import {
  BankLineKind,
  ParsedBankStatement,
  parseBankStatement,
  parseBankStatementPdf,
} from "./bankParser.service";

const LINE_KINDS: BankLineKind[] = [
  "standard",
  "loan_principal",
  "loan_interest",
  "overdraft_interest",
  "loan_mixed",
  "loan_fee",
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Everything that must be true of a parsed statement regardless of which file it
 * came from or which parser read it.
 */
function assertStatementInvariants(statement: ParsedBankStatement) {
  const { rows, report } = statement;
  const m = report.money;

  it("קרא לפחות שורה אחת ולא דחה אף אחת", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(report.rowsDetected).toBe(rows.length);
    expect(report.rowsRejected).toBe(0);
    expect(report.rejected).toHaveLength(0);
  });

  /**
   * Bank row resolution model: every row names its financial meaning. A row left
   * without one is a bug — it silently drops out of every figure in the app.
   */
  it("כל שורה קיבלה משמעות פיננסית מוכרת", () => {
    for (const row of rows) {
      expect(LINE_KINDS).toContain(row.lineKind);
      expect(["deposit", "withdrawal"]).toContain(row.type);
      expect(row.amount).toBeGreaterThan(0); // amounts are always positive; type carries direction
      expect(row.date).toBeInstanceOf(Date);
      expect(Number.isNaN(row.date.getTime())) .toBe(false);
    }
  });

  it("ספירת השורות לפי סוג מסתכמת במספר השורות", () => {
    const counted = LINE_KINDS.reduce((sum, kind) => sum + (report.byLineKind[kind] ?? 0), 0);
    expect(counted).toBe(rows.length);
  });

  /**
   * The single strongest check in the suite: replaying the statement from the
   * opening balance must land exactly on the closing balance the bank printed.
   * If a row was dropped, doubled, or read with the wrong sign, this breaks.
   */
  it("שחזור היתרה נסגר על היתרה שהבנק הדפיס", () => {
    expect(report.openingBalance).not.toBeNull();
    expect(report.closingBalance).not.toBeNull();
    const replayed = round2(report.openingBalance! + m.depositsRaw - m.withdrawalsRaw);
    expect(replayed).toBe(report.closingBalance);
  });

  it("אין אי־התאמות ביתרה הרצה", () => {
    expect(report.balanceMismatches).toHaveLength(0);
  });

  /**
   * CLAUDE.md §5 — four buckets that must never be merged, and that must account
   * for the column in full: a leak means money vanished from the reports, an
   * overlap means it is counted twice.
   */
  it("ארבע קטגוריות החובה מכסות את עמודת החובה במלואה — בלי דליפה ובלי כפילות", () => {
    const partition = round2(m.currentSpend + m.financingCharged + m.principal + m.mixed);
    expect(partition).toBe(m.withdrawalsRaw);
  });

  it("הכנסה לעולם אינה עולה על עמודת הזכות", () => {
    expect(m.income).toBeLessThanOrEqual(m.depositsRaw);
    expect(m.income).toBeGreaterThanOrEqual(0);
  });

  /** Round-trips are held out of BOTH sides until a human confirms them. */
  it("סבב כספים בהמתנה מנוכה גם מההכנסה וגם מההוצאה השוטפת", () => {
    expect(m.incomeConfirmed).toBe(round2(m.income - m.roundTripPending));
    expect(m.currentSpendConfirmed).toBe(round2(m.currentSpend - m.roundTripPending));
  });

  /** Netting interest is legal at account+month level only — never per loan. */
  it("ריבית מקוזזת = חיוב פחות זיכוי", () => {
    expect(m.financingNet).toBe(round2(m.financingCharged - m.financingRefunded));
    expect(m.financingRefunded).toBeGreaterThanOrEqual(0);
  });

  it("הקיזוז החודשי מסתכם בסך הריבית של כל הקובץ", () => {
    const charged = round2(report.monthFinancing.reduce((s, x) => s + x.charged, 0));
    const refunded = round2(report.monthFinancing.reduce((s, x) => s + x.refunded, 0));
    expect(charged).toBe(m.financingCharged);
    expect(refunded).toBe(m.financingRefunded);
    for (const month of report.monthFinancing) {
      expect(month.net).toBe(round2(month.charged - month.refunded));
      expect(month.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  /** Interest is reported gross per loan — netting there would hide real cost. */
  it("ריבית לפי הלוואה היא ברוטו ולעולם אינה שלילית", () => {
    for (const loan of report.loanFinancing) {
      expect(loan.interestChargedGross).toBeGreaterThan(0);
      expect(loan.lines).toBeGreaterThan(0);
      expect(loan.loanRef).not.toBe("");
    }
    const perLoan = round2(report.loanFinancing.reduce((s, l) => s + l.interestChargedGross, 0));
    expect(perLoan).toBeLessThanOrEqual(m.financingCharged);
  });

  it("טווח הכיסוי תקין ומסודר", () => {
    expect(report.coverageFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.coverageTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.coverageFrom! <= report.coverageTo!).toBe(true);
  });

  /**
   * The condition that waives loan 108's "הריבית עלינו" interest. A partial month
   * must answer "unknown", never "not_met" — the latter would report a lost
   * waiver when the month is merely still running.
   */
  it("חודש שאינו מכוסה במלואו נקבע כ־unknown ולעולם לא כלא־עומד", () => {
    for (const condition of report.monthlyConditions) {
      expect(["met", "not_met", "unknown"]).toContain(condition.state);
      if (!condition.fullyCovered) expect(condition.state).toBe("unknown");
      if (condition.state !== "unknown") expect(condition.fullyCovered).toBe(true);
    }
  });

  it("ההכרעה נגזרת מסך הפקדות השכר מול הסף — בלי יוצא מן הכלל", () => {
    for (const condition of report.monthlyConditions) {
      expect(condition.threshold).toBe(7000); // the loan-108 waiver threshold
      expect(condition.salaryTotal).toBeGreaterThanOrEqual(0);
      if (condition.state === "met") expect(condition.salaryTotal).toBeGreaterThanOrEqual(condition.threshold);
      if (condition.state === "not_met") expect(condition.salaryTotal).toBeLessThan(condition.threshold);
      expect(condition.reason.length).toBeGreaterThan(0);
    }
  });

  /**
   * "ממתין לאישור" qualifies a met condition: it reads as met only because of a
   * salary candidate nobody confirmed yet. It can never qualify anything else —
   * an unmet month has nothing to confirm.
   */
  it("ממתין לאישור מופיע רק על חודש שנקבע כעומד", () => {
    for (const condition of report.monthlyConditions) {
      if (condition.awaitingConfirmation) expect(condition.state).toBe("met");
    }
  });

  it("החודשים רציפים, כרונולוגיים וללא כפילות", () => {
    const months = report.monthlyConditions.map((c) => c.month);
    expect([...months].sort()).toEqual(months);
    expect(new Set(months).size).toBe(months.length);
  });
}

function goldenSuite(title: string, goldenKey: string, load: () => ParsedBankStatement) {
  describe(title, () => {
    const statement = load();

    assertStatementInvariants(statement);

    it.skipIf(!hasGolden(goldenKey))("הסכומים זהים ל־golden שנרשם", () => {
      expect(bankGolden(statement)).toEqual(readGolden(goldenKey));
    });
  });
}

describe.skipIf(!hasFixture("bankStatementJuly"))("דף חשבון עו״ש — Excel, חודש בודד", () => {
  goldenSuite("יולי 2026", "bank/excel/july", () => parseBankStatement(readFixture("bankStatementJuly")));
});

describe.skipIf(!hasFixture("bankStatementH1"))("דף חשבון עו״ש — Excel, רב־חודשי", () => {
  goldenSuite("ינואר–יולי 2026", "bank/excel/h1", () => parseBankStatement(readFixture("bankStatementH1")));

  /** A multi-month file is the only one that can prove per-month bucketing. */
  it("מפצל את הריבית ליותר מחודש אחד", () => {
    const { report } = parseBankStatement(readFixture("bankStatementH1"));
    expect(report.monthFinancing.length).toBeGreaterThan(1);
    const months = report.monthFinancing.map((m) => m.month);
    expect([...months].sort()).toEqual(months); // chronological
    expect(new Set(months).size).toBe(months.length); // no month twice
  });
});

/**
 * The PDF path reads the same account through a completely different code path.
 * It gets the same invariants — a regression that only shows up in PDF is exactly
 * the kind that reached production before (a PDF sent down the Excel route).
 */
describe.skipIf(!hasFixture("bankStatementPdf"))("דף חשבון עו״ש — PDF", () => {
  let statement: ParsedBankStatement;

  beforeAll(async () => {
    statement = await parseBankStatementPdf(readFixture("bankStatementPdf"));
  });

  it("נבחר פרסר PDF ולא פרסר Excel", () => {
    expect(statement.report.parser).toMatch(/^pdf-/);
  });

  it("שחזור היתרה נסגר על היתרה שהבנק הדפיס", () => {
    const { report } = statement;
    const m = report.money;
    expect(round2(report.openingBalance! + m.depositsRaw - m.withdrawalsRaw)).toBe(report.closingBalance);
  });

  it("ארבע קטגוריות החובה מכסות את עמודת החובה במלואה", () => {
    const m = statement.report.money;
    expect(round2(m.currentSpend + m.financingCharged + m.principal + m.mixed)).toBe(m.withdrawalsRaw);
  });

  it("כל שורה קיבלה משמעות פיננסית מוכרת ולא נדחתה אף שורה", () => {
    expect(statement.report.rowsRejected).toBe(0);
    expect(statement.rows.length).toBeGreaterThan(0);
    for (const row of statement.rows) expect(LINE_KINDS).toContain(row.lineKind);
  });

  it.skipIf(!hasGolden("bank/pdf"))("הסכומים זהים ל־golden שנרשם", () => {
    expect(bankGolden(statement)).toEqual(readGolden("bank/pdf"));
  });
});
