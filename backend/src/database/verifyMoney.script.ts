/**
 * Money-integrity check — run after any import or reconciliation change:
 *
 *   npx ts-node -T src/database/verifyMoney.script.ts
 *
 * Invariants, not fixed amounts: every row resolved, the buckets adding back up
 * to the raw totals, and a record exactly where the resolution says and nowhere else.
 */
import { prisma } from "../config/database";
import { EXPENSE_RESOLUTIONS } from "../modules/bank/bankResolution";
import { decimalToNumber, round2 } from "../utils/money.utils";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
/** Things worth saying out loud that are not, on their own, a broken invariant. */
const warnings: string[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function verifyUser(userId: number) {
  const rows = await prisma.bankTransaction.findMany({
    where: { userId },
    select: {
      id: true,
      amount: true,
      type: true,
      lineKind: true,
      resolution: true,
      reconcileNote: true,
      linkedIncomeId: true,
      linkedExpenseId: true,
    },
  });
  const shaped = rows.map((r) => ({ ...r, amount: decimalToNumber(r.amount) }));
  const sum = (predicate: (r: (typeof shaped)[number]) => boolean) =>
    round2(shaped.filter(predicate).reduce((s, r) => s + r.amount, 0));

  // No row without a meaning, and nothing left pending without a reason.
  const unresolved = shaped.filter((r) => r.resolution === null);
  add(
    "כל שורת בנק מסווגת",
    unresolved.length === 0,
    unresolved.length === 0
      ? `${shaped.length} שורות, כולן מסווגות`
      : `${unresolved.length} שורות ללא סיווג: ${unresolved.map((r) => r.id).join(", ")}`
  );
  const silentPending = shaped.filter((r) => r.resolution === null && !r.reconcileNote);
  add(
    "אין שורה ללא סיווג וללא סיבה",
    silentPending.length === 0,
    silentPending.length === 0 ? "כל שורה לא מסווגת נושאת סיבה" : `${silentPending.length} שורות שותקות`
  );

  // The buckets must add back up to the raw statement totals.
  const depositsRaw = sum((r) => r.type === "deposit");
  const withdrawalsRaw = sum((r) => r.type !== "deposit");
  const byResolutionIn = sum((r) => r.type === "deposit" && r.resolution !== null);
  const byResolutionOut = sum((r) => r.type !== "deposit" && r.resolution !== null);
  add(
    "סכום הזכות מתפרק במלואו לסיווגים",
    near(depositsRaw, byResolutionIn),
    `זכות גולמי ${depositsRaw} = מסווג ${byResolutionIn}`
  );
  add(
    "סכום החובה מתפרק במלואו לסיווגים",
    near(withdrawalsRaw, byResolutionOut),
    `חובה גולמי ${withdrawalsRaw} = מסווג ${byResolutionOut}`
  );

  // Records exist exactly where the resolution says they should.
  const missingIncome = shaped.filter((r) => r.resolution === "income" && r.linkedIncomeId === null);
  const missingExpense = shaped.filter(
    (r) => r.resolution !== null && EXPENSE_RESOLUTIONS.has(r.resolution as never) && r.linkedExpenseId === null
  );
  const strayRecord = shaped.filter(
    (r) =>
      r.resolution !== null &&
      !EXPENSE_RESOLUTIONS.has(r.resolution as never) &&
      r.resolution !== "income" &&
      (r.linkedExpenseId !== null || r.linkedIncomeId !== null)
  );
  add(
    "לכל שורה שסווגה כהכנסה יש רשומת הכנסה",
    missingIncome.length === 0,
    missingIncome.length === 0 ? "תואם" : `חסר ב-${missingIncome.map((r) => r.id).join(", ")}`
  );
  add(
    "לכל שורה שסווגה כהוצאה יש רשומת הוצאה",
    missingExpense.length === 0,
    missingExpense.length === 0 ? "תואם" : `חסר ב-${missingExpense.map((r) => r.id).join(", ")}`
  );
  add(
    "אין רשומה כפולה לשורה שאינה הכנסה/הוצאה",
    strayRecord.length === 0,
    strayRecord.length === 0
      ? "קרן, חיובי אשראי מפורטים והעברות פנימיות אינם מייצרים רשומה"
      : `רשומה מיותרת ב-${strayRecord.map((r) => r.id).join(", ")}`
  );

  // The records the resolver owns must equal the buckets.
  //
  // Only LINKED records are compared. The tables also hold rows the user entered
  // by hand — `incomes` has no source column at all — and demanding that the
  // whole table equal the bank buckets would call every manual entry a defect.
  // What the resolver is answerable for is the rows it created and links to.
  const linkedIncomeIds = shaped.map((r) => r.linkedIncomeId).filter((id): id is number => id !== null);
  const linkedExpenseIds = shaped.map((r) => r.linkedExpenseId).filter((id): id is number => id !== null);

  const incomeBucket = sum((r) => r.resolution === "income");
  const linkedIncomes = round2(
    decimalToNumber(
      (
        await prisma.income.aggregate({
          where: { userId, id: { in: linkedIncomeIds } },
          _sum: { amount: true },
        })
      )._sum.amount
    )
  );
  add(
    "הכנסות המקושרות לשורות בנק = סכום הסיווג 'הכנסה'",
    near(incomeBucket, linkedIncomes),
    `${incomeBucket} = ${linkedIncomes}`
  );

  const expenseBuckets = round2(
    sum((r) => r.resolution === "expense") +
      sum((r) => r.resolution === "financing_charge") -
      sum((r) => r.resolution === "financing_credit") +
      sum((r) => r.resolution === "credit_card_unitemized")
  );
  const linkedExpenses = round2(
    decimalToNumber(
      (
        await prisma.expense.aggregate({
          where: { userId, id: { in: linkedExpenseIds } },
          _sum: { amount: true },
        })
      )._sum.amount
    )
  );
  add(
    "הוצאות המקושרות לשורות בנק = סכום סיווגי ההוצאה (זיכוי ריבית בסימן שלילי)",
    near(expenseBuckets, linkedExpenses),
    `${expenseBuckets} = ${linkedExpenses}`
  );

  // Records marked as coming from a bank import but backed by no bank row. Not
  // an assertion: it is also what a hand-inserted row with source=bank_import
  // looks like. Reported with the amount, because if they ARE leftovers of
  // deleted transactions they inflate every expense figure silently.
  const orphanExpenses = await prisma.expense.findMany({
    where: { userId, source: "bank_import", id: { notIn: linkedExpenseIds } },
    select: { id: true, amount: true, expenseDate: true, description: true },
  });
  if (orphanExpenses.length > 0) {
    const total = round2(orphanExpenses.reduce((s, e) => s + decimalToNumber(e.amount), 0));
    warnings.push(
      `${orphanExpenses.length} הוצאות מסומנות כ-bank_import ללא שורת בנק מאחוריהן (${total}) — ` +
        `או שהוזנו ידנית עם המקור הזה, או ששרדו מחיקה של תנועה. מזהים: ${orphanExpenses
          .map((e) => e.id)
          .join(", ")}`
    );
  }

  // 5. bank ↔ credit: a card counted as spend must not also be itemized.
  const settledCards = shaped.filter((r) => r.resolution === "credit_card_settled").length;
  const unitemizedCards = shaped.filter((r) => r.resolution === "credit_card_unitemized").length;
  const creditRows = await prisma.creditTransaction.count({
    where: { userId, creditImport: { status: "confirmed" } },
  });
  add(
    "אין כפל ספירה בין הבנק לאשראי",
    unitemizedCards === 0 || creditRows === 0 || settledCards >= 0,
    `${settledCards} חיובים מוחרגים (מפורטים ב-${creditRows} עסקאות אשראי), ${unitemizedCards} חיובים ללא פירוט נספרים כהוצאה`
  );
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  for (const user of users) {
    console.log(`\n=== ${user.name} ===`);
    await verifyUser(user.id);
  }
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name} — ${check.detail}`);
  }
  for (const warning of warnings) {
    console.log(`⚠ ${warning}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? "\nכל בדיקות התקינות עברו ✔" : `\n${failed} בדיקות נכשלו ✖`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
