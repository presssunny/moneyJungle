import { prisma } from "../../config/database";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, percent, round2 } from "../../utils/money.utils";
import { spentByCategory } from "../dashboard/dashboard.service";
import { computeLoan } from "../loans/loanCalculator.service";
import { loansRepository } from "../loans/loans.repository";
import { alertsRepository } from "./alerts.repository";

interface DetectedAlert {
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

function formatILS(amount: number): string {
  return `₪${amount.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

/**
 * Detect alert conditions and persist any that aren't already recorded this month.
 * Runs lazily on every alerts fetch — dedupe is by (type, title) within the
 * current calendar month, so a fixed condition re-alerts next month only.
 */
export async function scanForAlerts(userId: number): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = monthRange(year, month);
  const detected: DetectedAlert[] = [];

  // 1. Budget overruns (and near-overruns) for the current month
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

  // 2. Expensive loans
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

  // 3. Negative balance this month (expenses above income)
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

  if (detected.length === 0) return;

  // Persist only alerts not already recorded this month (read or unread)
  const existing = await prisma.alert.findMany({
    where: { userId, createdAt: { gte: start } },
    select: { type: true, title: true },
  });
  const existingKeys = new Set(existing.map((a) => `${a.type}|${a.title}`));

  for (const alert of detected) {
    if (existingKeys.has(`${alert.type}|${alert.title}`)) continue;
    await alertsRepository.create(userId, alert);
  }
}
