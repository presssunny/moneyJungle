/**
 * Classification checks for the money-meaning rules (CLAUDE.md §5). No test
 * runner is configured, so this is a standalone script:
 *
 *   npx ts-node -T src/modules/bank/bankClassification.check.ts
 *
 * It covers the cases the statement on disk does not exercise — a loan drawdown,
 * a principal reversal, a supplier whose name contains an issuer name — where a
 * break would move money into the wrong figure instead of failing loudly.
 */
import { classifyBankLine, creditCardRefOf } from "./bankParser.service";

type Kind = "deposit" | "withdrawal";

const cases: Array<{ description: string; type: Kind; expected: string; why: string }> = [
  { description: "הלוואה 108 קבלת הלוואה", type: "deposit", expected: "loan_drawdown", why: "קבלת הלוואה אינה הכנסה" },
  { description: "העמדת הלוואה 4455", type: "deposit", expected: "loan_drawdown", why: "קבלת הלוואה אינה הכנסה" },
  {
    description: "הלוואה - תשלום ריבית 03757",
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
  { description: "הלוואה - תשלום קרן", type: "withdrawal", expected: "loan_principal", why: "קרן = הקטנת חוב" },
  { description: "הלואה-תשלום 108", type: "withdrawal", expected: "loan_mixed", why: "תשלום ללא פירוט קרן/ריבית" },
  {
    description: "הלוואה - תשלום קרן",
    type: "deposit",
    expected: "loan_principal",
    why: "קרן בזכות היא היפוך תשלום, לא קבלת הלוואה חדשה",
  },
  {
    description: "כרטיסי אשראי לי - 2349",
    type: "withdrawal",
    expected: "credit_card_payment",
    why: "חיוב כרטיס — נבדק מול דוח האשראי",
  },
  { description: 'עפ"י הרשאה כאל', type: "withdrawal", expected: "credit_card_payment", why: "הרשאה לחיוב לחברת אשראי" },
  { description: "כספומט ב 7468234", type: "withdrawal", expected: "standard", why: "משיכת מזומן — הוצאה" },
  { description: "העברה מהחשבון", type: "withdrawal", expected: "standard", why: "העברה — הוצאה עד שיימצא צד שני" },
  { description: "זיכוי", type: "deposit", expected: "standard", why: "תקבול כללי — הכנסה (סו״פ 222)" },
  { description: "קצבת ילדים", type: "deposit", expected: "standard", why: "קצבה — הכנסה" },
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

const cardRefCases: Array<{ text: string; expected: string | null }> = [
  { text: "כרטיסי אשראי לי - 2349", expected: "2349" },
  { text: "ויזה 2349", expected: "2349" },
  { text: "מאסטרקארד 7894", expected: "7894" },
  { text: 'עפ"י הרשאה כאל', expected: null },
];

let failed = 0;
for (const { description, type, expected, why } of cases) {
  const { lineKind } = classifyBankLine(description, type);
  const ok = lineKind === expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${type.padEnd(10)} ${description.padEnd(38)} → ${lineKind}` +
      (ok ? `   (${why})` : `   ✗ צפוי ${expected} — ${why}`)
  );
}
for (const { text, expected } of cardRefCases) {
  const got = creditCardRefOf(text).last4;
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} זיהוי כרטיס ${text.padEnd(28)} → ${got}${ok ? "" : ` (צפוי ${expected})`}`);
}

console.log(failed === 0 ? "\nכל הבדיקות עברו ✔" : `\n${failed} בדיקות נכשלו ✖`);
process.exitCode = failed === 0 ? 0 : 1;
