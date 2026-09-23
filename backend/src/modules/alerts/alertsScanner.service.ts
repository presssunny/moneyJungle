import { pendingDuplicates } from "../householdAssistant/duplicateReview.service";
import { prisma } from "../../config/database";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, formatILS, percent, round2 } from "../../utils/money.utils";
import { buildUpcoming, type UpcomingResponse } from "../dashboard/cashflow.service";
import { spentByCategory } from "../dashboard/dashboard.service";
import { expensesRepository } from "../expenses/expenses.repository";
import { computeLoan } from "../loans/loanCalculator.service";
import { loansRepository } from "../loans/loans.repository";
import { alertsRepository } from "./alerts.repository";

/** The alert types the app knows how to raise (mirrors the comment on `Alert.type`). */
export type AlertType =
  | "budget_overrun"
  | "high_credit_charge"
  | "duplicate_transaction"
  | "unused_subscription"
  | "upcoming_payment"
  | "balance_drop"
  | "uncategorized_expense"
  | "expensive_loan";

/** Same default window as GET /api/dashboard/upcoming, so the two never disagree. */
export const UPCOMING_WINDOW_DAYS = 45;
/** Share of one monthly cycle's outflow that makes a single day worth warning about. */
export const HEAVY_DAY_SHARE = 0.3;
/** Below this a missing category is noise, not a habit worth an alert. */
export const UNCATEGORIZED_MIN_ROWS = 5;
/** A charge this many times the personal baseline average is worth a second look. */
export const HIGH_CHARGE_MULTIPLIER = 3;
/** Floor so a multiple of a tiny baseline (e.g. avg 5 ₪) doesn't alert on noise. */
export const HIGH_CHARGE_MIN_AMOUNT = 300;
/** Below this many prior rows the average isn't a personal baseline yet. */
export const HIGH_CHARGE_MIN_HISTORY_ROWS = 10;
/** Trailing window the baseline average is computed over. */
export const HIGH_CHARGE_BASELINE_MONTHS = 3;

interface DetectedAlert {
  type: AlertType;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  /** Set by scans that withdraw their own stale findings; the title is wording, not identity. */
  evidenceKey?: string;
}

export function formatDayMonth(date: Date): string {
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
}

/**
 * Concentration, not size — a recurring day appears twice in the 45-day window,
 * so its share is measured against one monthly cycle, not the whole window.
 * Exported: the unified attention list asks the same question.
 */
export function isHeavyDay(upcoming: UpcomingResponse): boolean {
  const heaviest = upcoming.heaviestDay;
  if (!heaviest || upcoming.total <= 0 || heaviest.count < 2) return false;
  const cycleTotal = (upcoming.total * 30) / UPCOMING_WINDOW_DAYS;
  return heaviest.total >= cycleTotal * HEAVY_DAY_SHARE;
}

/**
 * Detect alert conditions and persist any that aren't already showing this month.
 * Runs lazily on every alerts fetch — dedupe is by evidence key where a scan
 * provides one and by (type, title) otherwise, within the current calendar
 * month, so a fixed condition re-alerts next month only.
 */
export async function scanForAlerts(userId: number): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = monthRange(year, month);
  const detected: DetectedAlert[] = [];

  // Budget overruns (and near-overruns) for the current month
  const budgets = await prisma.budget.findMany({
    where: { userId, year, month },
    include: { category: true },
  });
  if (budgets.length > 0) {
    const spent = await spentByCategory(userId, year, month);
    for (const budget of budgets) {
      const amount = decimalToNumber(budget.amount);
      const used = spent.get(budget.categoryId) ?? 0;
      const usedPercent = percent(used, amount);
      if (usedPercent > 100) {
        detected.push({
          type: "budget_overrun",
          title: `חריגה ב${budget.category.name}`,
          message: `נוצלו ${formatILS(round2(used))} מתוך תקציב של ${formatILS(amount)} — ${formatILS(round2(used - amount))} מעל התקציב.`,
          severity: "critical",
        });
      } else if (usedPercent >= 90) {
        detected.push({
          type: "budget_overrun",
          title: `תקציב ${budget.category.name} כמעט נגמר`,
          message: `נוצלו ${Math.round(usedPercent)}% מהתקציב (${formatILS(round2(used))} מתוך ${formatILS(amount)}).`,
          severity: "warning",
        });
      }
    }
  }

  // Expensive loans
  const loans = await loansRepository.findActive(userId);
  for (const loan of loans) {
    const rate = decimalToNumber(loan.annualInterestRate);
    const computed = computeLoan({
      currentBalance: decimalToNumber(loan.currentBalance),
      annualInterestRate: rate,
      monthlyPayment: decimalToNumber(loan.monthlyPayment),
    });
    if (computed.isExpensive) {
      detected.push({
        type: "expensive_loan",
        title: `ריבית גבוהה: ${loan.loanName}`,
        message: `ריבית שנתית של ${rate}% עולה כ־${formatILS(computed.monthlyInterestPayment)} בחודש. שווה לבדוק מחזור או פירעון מוקדם.`,
        severity: "warning",
      });
    }
    if (computed.remainingMonths === null) {
      detected.push({
        type: "expensive_loan",
        title: `ההחזר על ${loan.loanName} לא מכסה את הריבית`,
        message: `בהחזר הנוכחי (${formatILS(decimalToNumber(loan.monthlyPayment))}) ההלוואה לעולם לא תיסגר — היתרה רק גדלה.`,
        severity: "critical",
      });
    }
  }

  // unused_subscription not implemented: nothing advances `billingDate` on its
  // own, so a staleness check needs a roll-forward job or bank/credit matching —
  // banker's call, see docs/roadmap-next-phase.md.

  // Payment pressure ahead: several charges on the same day. Same forecast the
  // dashboard shows, same threshold as the unified attention list (`isHeavyDay`).
  const upcoming = await buildUpcoming(userId, UPCOMING_WINDOW_DAYS);
  const heaviest = upcoming.heaviestDay;
  if (heaviest && isHeavyDay(upcoming)) {
    const heaviestDate = new Date(heaviest.date);
    detected.push({
      // Title stays static: a date here would defeat the type|title dedupe key
      // as the heaviest day rolls forward with the window.
      type: "upcoming_payment",
      title: "יום עמוס בתשלומים",
      message: `${heaviest.count} חיובים בסך ${formatILS(heaviest.total)} מתרכזים ב־${formatDayMonth(heaviestDate)} — ${Math.round(percent(heaviest.total, upcoming.total))}% מכל התשלומים הצפויים ב־${UPCOMING_WINDOW_DAYS} הימים הקרובים.`,
      severity: "warning",
    });
  }

  // Negative balance this month (expenses above income)
  const [incomes, expenses] = await Promise.all([
    prisma.income.aggregate({ where: { userId, incomeDate: { gte: start, lt: end } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { userId, expenseDate: { gte: start, lt: end } }, _sum: { amount: true } }),
  ]);
  const incomeTotal = decimalToNumber(incomes._sum.amount);
  const expenseTotal = decimalToNumber(expenses._sum.amount);
  if (incomeTotal > 0 && expenseTotal > incomeTotal) {
    detected.push({
      type: "balance_drop",
      title: "ההוצאות עברו את ההכנסות החודש",
      message: `הוצאות ${formatILS(expenseTotal)} מול הכנסות ${formatILS(incomeTotal)} — חריגה של ${formatILS(round2(expenseTotal - incomeTotal))}.`,
      severity: "critical",
    });
  }

  // Rows with no category, counted over the same merged view the expenses tab
  // shows (manual + confirmed non-financing credit by billingDate).
  const [monthExpenses, monthCredit] = await Promise.all([
    expensesRepository.findByMonth(userId, start, end),
    expensesRepository.findCreditByMonth(userId, start, end),
  ]);
  const uncategorized = [...monthExpenses, ...monthCredit].filter((row) => row.categoryId === null);
  if (uncategorized.length >= UNCATEGORIZED_MIN_ROWS) {
    const missingTotal = round2(uncategorized.reduce((sum, row) => sum + decimalToNumber(row.amount), 0));
    detected.push({
      type: "uncategorized_expense",
      title: "הוצאות ללא קטגוריה",
      message: `${uncategorized.length} הוצאות בסך ${formatILS(missingTotal)} עדיין בלי קטגוריה החודש — בלעדיהן הפילוח והתקציבים חלקיים.`,
      severity: "info",
    });
  }

  // A single charge worth far more than this person's usual credit spending —
  // baseline is their own trailing-3-month average, not a fixed number, so it
  // adapts per household. `financing` (revolving credit) and unconfirmed
  // imports are excluded, same as every other credit sum in the app (CLAUDE.md
  // §5): a rolling-credit line is not a spending spike, and a draft import is
  // not a statement she stands behind yet.
  const baselineStart = new Date(Date.UTC(year, month - 1 - HIGH_CHARGE_BASELINE_MONTHS, 1));
  const baselineRows = await prisma.creditTransaction.findMany({
    where: { userId, billingDate: { gte: baselineStart, lt: start }, transactionType: { not: "financing" }, creditImport: { status: "confirmed" } },
    select: { amount: true },
  });
  const baselineAvg = baselineRows.length ? baselineRows.reduce((sum, row) => sum + decimalToNumber(row.amount), 0) / baselineRows.length : 0;
  if (baselineRows.length >= HIGH_CHARGE_MIN_HISTORY_ROWS && baselineAvg > 0) {
    const threshold = Math.max(baselineAvg * HIGH_CHARGE_MULTIPLIER, HIGH_CHARGE_MIN_AMOUNT);
    for (const row of monthCredit) {
      const amount = decimalToNumber(row.amount);
      if (amount <= threshold) continue;
      detected.push({
        type: "high_credit_charge",
        title: `חיוב גבוה מהרגיל: ${row.businessName}`,
        message: `חיוב של ${formatILS(round2(amount))} אצל ${row.businessName} — פי ${Math.round(amount / baselineAvg)} מהחיוב הממוצע (${formatILS(round2(baselineAvg))}) בשלושת החודשים האחרונים.`,
        severity: "info",
      });
    }
  }

  // Human double-entry: the same expense typed in twice. The candidates come
  // from the review scan, so the alert and the screen that resolves it can
  // never disagree about what counts as a duplicate (CLAUDE.md §4). That scan
  // already drops groups the household has judged, and already excludes
  // imported, bank-linked and card rows — an import dedupes at its own source,
  // and credit purchases never become `Expense` rows at all.
  const withinMonth = (date: string) => date >= start.toISOString().slice(0, 10) && date < end.toISOString().slice(0, 10);
  const duplicates = await pendingDuplicates(userId);
  const openGroups = duplicates.pending.filter(c => c.reason === "same_entry" && c.records.every(r => r.kind === "expense"));
  for (const group of openGroups.filter(c => c.records.every(r => withinMonth(r.date)))) {
    const [first] = group.records;
    detected.push({
      type: "duplicate_transaction",
      evidenceKey: group.id,
      title: `כפילות אפשרית: ${first.name}`,
      message: `${group.recordCount} הוצאות זהות ב-${formatDayMonth(new Date(first.date))}: ${first.name}, ${formatILS(first.amount)} כל אחת. ייתכן שנרשמה פעמיים בטעות.`,
      severity: "info",
    });
  }

  // A finding the scan no longer sees is withdrawn from view, never deleted —
  // the household was shown it, and why it went away is not always recorded.
  // Withdrawal spans the whole scan window, not the month an alert was raised
  // in: a finding resolved on the 1st is no longer live, whatever day it began.
  // A truncated scan cannot prove a group is gone, so it withdraws nothing.
  const liveKeys = openGroups.map(group => group.id);
  if (!duplicates.scan.limited) await prisma.alert.updateMany({
    where: { userId, type: "duplicate_transaction", withdrawnAt: null,
      ...(liveKeys.length ? { OR: [{ evidenceKey: null }, { evidenceKey: { notIn: liveKeys } }] } : {}) },
    data: { withdrawnAt: new Date() },
  });
  if (detected.length === 0) return;

  // Persist only alerts not already showing this month (read or unread)
  const existing = await prisma.alert.findMany({
    where: { userId, createdAt: { gte: start }, withdrawnAt: null },
    select: { type: true, title: true, evidenceKey: true },
  });
  const existingKeys = new Set(existing.map((a) => a.evidenceKey ?? `${a.type}|${a.title}`));

  for (const alert of detected) {
    if (existingKeys.has(alert.evidenceKey ?? `${alert.type}|${alert.title}`)) continue;
    await alertsRepository.create(userId, alert);
  }
}
