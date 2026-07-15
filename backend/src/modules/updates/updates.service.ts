import { prisma } from "../../config/database";
import { addDays, daysUntil, monthRange, startOfToday } from "../../utils/date.utils";
import { decimalToNumber, percent, round2 } from "../../utils/money.utils";
import { spentByCategory } from "../dashboard/dashboard.service";
import { computeLoan } from "../loans/loanCalculator.service";
import { loansRepository } from "../loans/loans.repository";
import { remindersRepository } from "../reminders/reminders.repository";

export type TickerSeverity = "info" | "warning" | "critical";

export interface TickerItem {
  id: string;
  type: string;
  icon: string;
  text: string;
  severity: TickerSeverity;
  linkTo: string;
  date: string | null;
}

const SEVERITY_ORDER: Record<TickerSeverity, number> = { critical: 0, warning: 1, info: 2 };
const BUDGET_WARN_PERCENT = 85;

function relativeDay(date: Date): string {
  const days = daysUntil(date);
  if (days <= 0) return "היום";
  if (days === 1) return "מחר";
  if (days <= 7) return `בעוד ${days} ימים`;
  return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function formatILS(amount: number): string {
  return `₪${amount.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

export const updatesService = {
  async ticker(userId: number): Promise<TickerItem[]> {
    const items: TickerItem[] = [];
    const today = startOfToday();
    const now = new Date();

    // 1. Reminders — next 14 days
    const reminders = await remindersRepository.findUpcoming(userId, today, addDays(today, 14));
    for (const reminder of reminders) {
      const amount = reminder.estimatedAmount
        ? ` — ${reminder.type === "birthday" ? "מתנה מתוכננת " : "~"}${formatILS(decimalToNumber(reminder.estimatedAmount))}`
        : "";
      items.push({
        id: `reminder-${reminder.id}`,
        type: "reminder",
        icon: reminder.icon ?? "🔔",
        text: `${relativeDay(reminder.eventDate)}: ${reminder.title}${amount}`,
        severity: daysUntil(reminder.eventDate) <= 1 ? "warning" : "info",
        linkTo: "/calendar",
        date: reminder.eventDate.toISOString(),
      });
    }

    // 2. Recurring payments + subscriptions due within 7 days
    const weekAhead = addDays(today, 7);
    const [recurring, subscriptions] = await Promise.all([
      prisma.recurringPayment.findMany({
        where: { userId, nextPaymentDate: { gte: today, lte: weekAhead } },
      }),
      prisma.subscription.findMany({
        where: { userId, status: "active", billingDate: { gte: today, lte: weekAhead } },
      }),
    ]);
    for (const payment of recurring) {
      items.push({
        id: `recurring-${payment.id}`,
        type: "recurring_payment",
        icon: "🔁",
        text: `${relativeDay(payment.nextPaymentDate)}: חיוב ${payment.name} ${formatILS(decimalToNumber(payment.amount))}`,
        severity: "info",
        linkTo: "/recurring",
        date: payment.nextPaymentDate.toISOString(),
      });
    }
    for (const subscription of subscriptions) {
      items.push({
        id: `subscription-${subscription.id}`,
        type: "subscription",
        icon: "📺",
        text: `${relativeDay(subscription.billingDate)}: חיוב מנוי ${subscription.name} ${formatILS(decimalToNumber(subscription.amount))}`,
        severity: "info",
        linkTo: "/subscriptions",
        date: subscription.billingDate.toISOString(),
      });
    }

    // 3. Unread alerts
    const alerts = await prisma.alert.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    for (const alert of alerts) {
      items.push({
        id: `alert-${alert.id}`,
        type: "alert",
        icon: alert.severity === "critical" ? "🚨" : "⚠️",
        text: alert.title,
        severity: alert.severity === "critical" ? "critical" : "warning",
        linkTo: "/alerts",
        date: alert.createdAt.toISOString(),
      });
    }

    // 4. Expected credit charge for the current month
    const { start, end } = monthRange(now.getFullYear(), now.getMonth() + 1);
    const credit = await prisma.creditTransaction.aggregate({
      where: {
        userId,
        billingDate: { gte: start, lt: end },
        transactionType: { not: "financing" },
        creditImport: { status: "confirmed" },
      },
      _sum: { amount: true },
    });
    const creditTotal = decimalToNumber(credit._sum.amount);
    if (creditTotal > 0) {
      items.push({
        id: "credit-monthly",
        type: "credit_charge",
        icon: "💳",
        text: `חיוב אשראי צפוי החודש: ${formatILS(creditTotal)}`,
        severity: "info",
        linkTo: "/credit",
        date: null,
      });
    }

    // 5. Budgets at or above the warning threshold
    const budgets = await prisma.budget.findMany({
      where: { userId, year: now.getFullYear(), month: now.getMonth() + 1 },
      include: { category: true },
    });
    if (budgets.length > 0) {
      const spent = await spentByCategory(userId, now.getFullYear(), now.getMonth() + 1);
      for (const budget of budgets) {
        const amount = decimalToNumber(budget.amount);
        const used = spent.get(budget.categoryId) ?? 0;
        const usedPercent = percent(used, amount);
        if (usedPercent >= BUDGET_WARN_PERCENT) {
          const over = usedPercent > 100;
          items.push({
            id: `budget-${budget.id}`,
            type: "budget",
            icon: over ? "🔴" : "🟡",
            text: over
              ? `חריגה בתקציב ${budget.category.name}: ${formatILS(round2(used - amount))} מעל התקציב`
              : `תקציב ${budget.category.name}: נוצלו ${Math.round(usedPercent)}%`,
            severity: over ? "critical" : "warning",
            linkTo: "/budgets",
            date: null,
          });
        }
      }
    }

    // 6. Expensive loans
    const loans = await loansRepository.findActive(userId);
    for (const loan of loans) {
      const rate = decimalToNumber(loan.annualInterestRate);
      const computed = computeLoan({
        currentBalance: decimalToNumber(loan.currentBalance),
        annualInterestRate: rate,
        monthlyPayment: decimalToNumber(loan.monthlyPayment),
      });
      if (computed.isExpensive) {
        items.push({
          id: `loan-${loan.id}`,
          type: "expensive_loan",
          icon: "🏦",
          text: `${loan.loanName}: ריבית ${rate}% — שווה לבדוק מחזור או סגירה מוקדמת`,
          severity: "warning",
          linkTo: "/loans",
          date: null,
        });
      }
    }

    return items.sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severityDiff !== 0) return severityDiff;
      if (a.date && b.date) return a.date.localeCompare(b.date);
      return a.date ? -1 : 1;
    });
  },
};
