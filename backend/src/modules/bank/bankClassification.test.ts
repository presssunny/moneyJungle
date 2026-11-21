/**
 * The money-meaning rules (CLAUDE.md §5). Each case's `why` is its assertion
 * name, so a failure names the financial rule that broke. Covers what the
 * statements on disk do not: drawdowns, principal reversals, false-friend names.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  classifyBankLine,
  creditCardRefOf,
  describeIngestionIssueCounts,
  DIRECT_DEBIT_REVIEW_REASON,
  parseBankStatement,
  reclassifyStoredLine,
} from "./bankParser.service";

type Kind = "deposit" | "withdrawal";

interface Case {
  description: string;
  type: Kind;
  expected: string;
  why: string;
}

const drawdownCases: Case[] = [
  { description: "הלוואה 108 קבלת הלוואה", type: "deposit", expected: "loan_drawdown", why: "קבלת הלוואה אינה הכנסה" },
  { description: "העמדת הלוואה 4455", type: "deposit", expected: "loan_drawdown", why: "קבלת הלוואה אינה הכנסה" },
];

const financingCases: Case[] = [
  {
    description: "הלוואה - תשלום ריבית 00000",
    type: "deposit",
    expected: "interest_credit",
    why: "ריבית בזכות היא זיכוי ריבית, לא הכנסה",
  },
  {
    description: "זיכוי בגין הטבה זמנית בריבית משיכת יתר",
    type: "deposit",
    expected: "interest_credit",
    why: "זיכוי ריבית מסגרת — הוצאה מימונית שלילית",
  },
  { description: "ריבית על הלוואה 09/07 00965", type: "withdrawal", expected: "loan_interest", why: "ריבית היא הוצאה" },
  {
    description: "ריבית על מסגרת ראשית 28/05 13.00%",
    type: "withdrawal",
    expected: "overdraft_interest",
    why: "ריבית מסגרת היא הוצאה מימונית",
  },
];

const repaymentCases: Case[] = [
  { description: "הלוואה - תשלום קרן", type: "withdrawal", expected: "loan_principal", why: "קרן = הקטנת חוב" },
  { description: "הלואה-תשלום 108", type: "withdrawal", expected: "loan_mixed", why: "תשלום ללא פירוט קרן/ריבית" },
  {
    description: "הלוואה - תשלום קרן",
    type: "deposit",
    expected: "loan_principal",
    why: "קרן בזכות היא היפוך תשלום, לא קבלת הלוואה חדשה",
  },
];

const creditCardCases: Case[] = [
  {
    description: "כרטיסי אשראי לי - 2349",
    type: "withdrawal",
    expected: "credit_card_payment",
    why: "חיוב כרטיס — נבדק מול דוח האשראי",
  },
  { description: 'עפ"י הרשאה כאל', type: "withdrawal", expected: "credit_card_payment", why: "הרשאה לחיוב לחברת אשראי" },
  {
    description: "כרטיסי אשראי לי - 1234",
    type: "withdrawal",
    expected: "credit_card_payment",
    why: "המילים כרטיסי אשראי מספיקות",
  },
];

/**
 * A direct debit names its payee, not a card (banker 2026-11-14): only an issuer
 * or "כרטיס אשראי" makes it a card settlement. Otherwise it is spending.
 */
const directDebitCases: Case[] = [
  {
    description: "הרשאה לחיוב הראל ביטוח",
    type: "withdrawal",
    expected: "standard",
    why: "הוראת קבע לביטוח היא הוצאה, לא חיוב כרטיס",
  },
  {
    description: "עפ״י הרשאה חברת חשמל",
    type: "withdrawal",
    expected: "standard",
    why: "הוראת קבע לחשמל היא הוצאה, לא חיוב כרטיס",
  },
  { description: "הרשאה לחיוב החזר", type: "deposit", expected: "standard", why: "זיכוי לפי עמודת הזכות — לא מושפע" },
];

const standardCases: Case[] = [
  { description: "כספומט ב 7468234", type: "withdrawal", expected: "standard", why: "משיכת מזומן — הוצאה" },
  { description: "העברה מהחשבון", type: "withdrawal", expected: "standard", why: "העברה — הוצאה עד שיימצא צד שני" },
  { description: "זיכוי", type: "deposit", expected: "standard", why: "תקבול כללי — הכנסה (סו״פ 222)" },
  { description: "קצבת ילדים", type: "deposit", expected: "standard", why: "קצבה — הכנסה" },
];

/**
 * Hebrew has no word boundary a regex can lean on: "כאל" sits inside "מיכאל"
 * and "מקס" inside "מקסימום". A substring match here would exclude a real
 * household expense from the spending figure.
 */
const falseFriendCases: Case[] = [
  {
    description: 'מיכאל אלגרבלי בע"מ',
    type: "withdrawal",
    expected: "standard",
    why: '"כאל" בתוך "מיכאל" אינו חברת אשראי — אחרת הוצאה אמיתית הייתה מוחרגת',
  },
  {
    description: "מקסימום ספורט",
    type: "withdrawal",
    expected: "standard",
    why: '"מקס" בתוך "מקסימום" אינו חברת אשראי',
  },
];

/**
 * Closing a loan early: the fee lines carry no the word "הלוואה" at all, so
 * before these patterns existed they fell through to "standard" and were
 * counted as ordinary household spending.
 */
const earlyPayoffFeeCases: Case[] = [
  {
    description: "ע. פרעון מוקדם",
    type: "withdrawal",
    expected: "loan_fee",
    why: "עמלת פירעון מוקדם — עלות מימון, לא הוצאה שוטפת",
  },
  {
    description: "עמלת אי הודעה מוקדמת - פירעון מוקדם",
    type: "withdrawal",
    expected: "loan_fee",
    why: "עמלת סגירה — עלות מימון, לא הוצאה שוטפת",
  },
];

function runCases(title: string, cases: Case[]) {
  describe(title, () => {
    for (const { description, type, expected, why } of cases) {
      it(`${type} · "${description}" → ${expected} · ${why}`, () => {
        expect(classifyBankLine(description, type).lineKind).toBe(expected);
      });
    }
  });
}

runCases("קבלת הלוואה", drawdownCases);
runCases("ריבית וזיכויי ריבית", financingCases);
runCases("החזרי הלוואה", repaymentCases);
runCases("חיובי כרטיס אשראי", creditCardCases);
runCases("הרשאות לחיוב שאינן כרטיס", directDebitCases);
runCases("תנועות רגילות", standardCases);
runCases("שמות שמכילים שם חברת אשראי", falseFriendCases);
runCases("עמלות פירעון מוקדם", earlyPayoffFeeCases);

/**
 * A loan number must survive classification: a payoff line prints it
 * ("הלוואה - תשלום קרן 108"), and without it nothing can tell which loan closed.
 */
describe("שימור מספר ההלוואה", () => {
  const cases: Array<{ description: string; type: Kind; expected: string | null; why: string }> = [
    {
      description: "הלוואה - תשלום קרן 108",
      type: "withdrawal",
      expected: "108",
      why: "שורת פירעון נושאת את מספר ההלוואה — בלעדיו אין סגירה אוטומטית",
    },
    {
      description: "הלוואה - תשלום קרן",
      type: "withdrawal",
      expected: null,
      why: "תשלום קרן חודשי רגיל אינו מדפיס מספר",
    },
    { description: "הלואה-תשלום 108", type: "withdrawal", expected: "108", why: "תשלום מעורב נושא מספר" },
    {
      description: "הלוואה - תשלום ריבית 00965",
      type: "withdrawal",
      expected: "00965",
      why: "שורת ריבית נושאת את מספר המסלול",
    },
  ];

  for (const { description, type, expected, why } of cases) {
    it(`"${description}" → ${expected ?? "null"} · ${why}`, () => {
      expect(classifyBankLine(description, type).loanRef).toBe(expected);
    });
  }

  it("שומר על אפסים מובילים — 00965 אינו 965", () => {
    expect(classifyBankLine("הלוואה - תשלום ריבית 00965", "withdrawal").loanRef).toBe("00965");
  });
});

describe("creditCardRefOf — זיהוי 4 ספרות אחרונות", () => {
  const cases: Array<{ text: string; expected: string | null }> = [
    { text: "כרטיסי אשראי לי - 2349", expected: "2349" },
    { text: "ויזה 2349", expected: "2349" },
    { text: "מאסטרקארד 7894", expected: "7894" },
    { text: 'עפ"י הרשאה כאל', expected: null },
  ];

  for (const { text, expected } of cases) {
    it(`"${text}" → ${expected ?? "null"}`, () => {
      expect(creditCardRefOf(text).last4).toBe(expected);
    });
  }

  it("לא נופל על תיאור ריק או null", () => {
    expect(creditCardRefOf(null).last4).toBeNull();
    expect(creditCardRefOf("").last4).toBeNull();
  });
});

/**
 * CLAUDE.md §5: the physical column decides income vs expense, never the text.
 * The same description on the other side of the statement must not be forced
 * back to the side its wording suggests.
 */
describe("העמודה הפיזית קובעת — לא הטקסט", () => {
  it("אותו תיאור בחובה ובזכות אינו מקבל בהכרח אותה משמעות", () => {
    const asWithdrawal = classifyBankLine("הלוואה - תשלום קרן", "withdrawal");
    const asDeposit = classifyBankLine("הלוואה - תשלום קרן", "deposit");
    expect(asWithdrawal.lineKind).toBe("loan_principal");
    expect(asDeposit.lineKind).toBe("loan_principal"); // reversal, not a new loan
  });

  it("תיאור ריבית בזכות אינו הופך להוצאת ריבית", () => {
    expect(classifyBankLine("הלוואה - תשלום ריבית 00000", "deposit").lineKind).toBe("interest_credit");
    expect(classifyBankLine("הלוואה - תשלום ריבית 00000", "withdrawal").lineKind).toBe("loan_interest");
  });
});

/**
 * Re-running the rules over stored rows must not move her past money: a row stored
 * as a card settlement that the new rule calls a direct debit waits for her approval.
 */
describe("סיווג מחדש של שורות שמורות", () => {
  it("חיוב כרטיס שמור שהוא רק הרשאה לחיוב נשאר כפי שנשמר", () => {
    expect(reclassifyStoredLine("credit_card_payment", "הרשאה לחיוב הראל ביטוח", "withdrawal")).toEqual({
      lineKind: "credit_card_payment",
      loanRef: null,
      heldForApproval: true,
    });
  });

  it("כל שינוי אחר עדיין מתעדכן", () => {
    expect(reclassifyStoredLine("standard", "הלוואה - תשלום קרן 108", "withdrawal")).toEqual({
      lineKind: "loan_principal",
      loanRef: "108",
      heldForApproval: false,
    });
    expect(reclassifyStoredLine("credit_card_payment", 'עפ"י הרשאה כאל', "withdrawal").heldForApproval).toBe(false);
  });
});

function statement(lines: Array<[string, string, number | null, number | null, number]>): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([["תאריך", "תיאור", "חובה", "זכות", "יתרה"], ...lines]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "דף");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("הרשאה לחיוב בלי חברת כרטיס — לאישור שלה", () => {
  it("נספרת כהוצאה ומסומנת לבדיקת סיווג; הרשאה לכאל אינה מסומנת", () => {
    const { rows, report } = parseBankStatement(
      statement([
        ["01/07/2026", "משכורת", null, 10000, 10000],
        ["05/07/2026", "הרשאה לחיוב הראל ביטוח", 300, null, 9700],
        ["10/07/2026", 'עפ"י הרשאה כאל', 1500, null, 8200],
      ])
    );
    expect(rows.map((r) => classifyBankLine(r.description, r.type).lineKind)).toEqual(["standard", "standard", "credit_card_payment"]);
    const classification = report.review.filter((issue) => issue.kind === "classification");
    expect(classification).toHaveLength(1);
    expect(classification[0]!.reason).toBe(DIRECT_DEBIT_REVIEW_REASON);
    expect(describeIngestionIssueCounts(report)).toBe("1 הרשאות לחיוב בלי חברת כרטיס — נספרו כהוצאה");
  });
});
