/**
 * The money-meaning rules (CLAUDE.md §5). Each case's `why` is its assertion
 * name, so a failure names the financial rule that broke. Covers what the
 * statements on disk do not: drawdowns, principal reversals, false-friend names.
 */
import { describe, expect, it } from "vitest";
import { classifyBankLine, creditCardRefOf } from "./bankParser.service";

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
