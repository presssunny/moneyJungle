import { prisma } from "../../config/database";
import { addDays, daysUntil, monthRange, relativeDayLabel, startOfToday } from "../../utils/date.utils";
import { decimalToNumber, formatILS } from "../../utils/money.utils";
import { alertsService } from "../alerts/alerts.service";
import { formatDayMonth, isHeavyDay, UPCOMING_WINDOW_DAYS } from "../alerts/alertsScanner.service";
import { remindersRepository } from "../reminders/reminders.repository";
import { buildUpcoming } from "./cashflow.service";
import { dashboardService } from "./dashboard.service";

/**
 * "מה דורש תשומת לב" from every source at once — alerts, reminders, the forward
 * cash-flow forecast and the dashboard's own review counters. A READ-TIME MERGE,
 * deliberately: no Notification table, no copying between tables (CLAUDE.md §4).
 * The merge also dedupes — the forecast and an `upcoming_payment` alert can
 * describe the same heavy day, and the panel must say it once.
 */

export type AttentionTone = "info" | "warning" | "critical";

/** Exactly what `AttentionPanel` renders — mirrored in frontend/src/types/models.ts. */
export interface AttentionItem {
  id: string;
  icon: string;
  text: string;
  to: string;
  tone: AttentionTone;
}

export type AttentionSource = "summary" | "credit" | "alert" | "upcoming" | "reminder";

export interface AttentionCandidate extends AttentionItem {
  source: AttentionSource;
  /** What the line is ABOUT. The same topic from two sources is one fact worded twice. */
  topic: string;
  /** Lowest wins inside a topic, and orders lines that share a tone. */
  priority: number;
  /** An alert already marked read: it silences its topic without showing itself. */
  dismissed?: boolean;
}

/** Same horizon the ticker gives reminders — far enough to act, near enough to matter. */
export const REMINDER_WINDOW_DAYS = 14;
const MAX_REMINDER_ITEMS = 2;
/** The panel renders four lines; alerts must not crowd out the structural ones. */
const MAX_ALERT_ITEMS = 2;

const TONE_RANK: Record<AttentionTone, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Order inside a tone, and the tie-break that decides who owns a shared topic.
 * Unresolved bank rows lead: money that sits in no total is the one thing the
 * dashboard must never stay quiet about.
 */
const PRIORITY = {
  bankUnresolved: 0,
  budget: 10,
  bankReview: 20,
  creditPending: 21,
  bankCoarse: 25,
  alert: 30,
  budgetSingle: 35,
  heavyDay: 45,
  reminder: 50,
} as const;

/**
 * Alert types that speak about the same thing a computed source does. Anything
 * else keeps its own topic (id included) so two loans stay two lines.
 */
const SHARED_ALERT_TOPIC: Record<string, string> = {
  budget_overrun: "budget",
  upcoming_payment: "upcoming_payment",
};

const TONE_ICON: Record<AttentionTone, string> = { critical: "🚨", warning: "⚠️", info: "ℹ️" };

interface AlertRow {
  id: number;
  type: string;
  title: string;
  severity: AttentionTone;
}

function alertCandidate(alert: AlertRow, dismissed: boolean): AttentionCandidate {
  return {
    id: `alert-${alert.id}`,
    icon: TONE_ICON[alert.severity],
    text: alert.title,
    to: "/manage?tab=alerts",
    tone: alert.severity,
    source: "alert",
    topic: SHARED_ALERT_TOPIC[alert.type] ?? `alert:${alert.type}:${alert.id}`,
    priority: PRIORITY.alert,
    dismissed,
  };
}

/**
 * Every line the four sources want to show, before dedupe. Split out from the
 * merge so a test can watch two sources collide on one topic and then watch the
 * merge resolve it.
 */
export async function collectAttentionCandidates(
  userId: number,
  year: number,
  month: number
): Promise<AttentionCandidate[]> {
  // Listing alerts first runs the lazy scanner (alerts raise on read, not a
  // cron), so a first-ever load sees alert wording, not raw forecast wording.
  await alertsService.list(userId);
  const today = startOfToday();
  // Scoped to the viewed month: scanForAlerts dedupes by (type|title) per
  // calendar month, so an unread alert from an earlier month no longer holds.
  const { start: monthStart, end: monthEnd } = monthRange(year, month);
  const [summary, pendingImports, upcoming, reminders, unreadAlerts, dismissedAlerts] = await Promise.all([
    dashboardService.summary(userId, year, month),
    prisma.creditImport.findMany({
      where: { userId, status: { not: "confirmed" } },
      select: { totalTransactions: true },
    }),
    buildUpcoming(userId, UPCOMING_WINDOW_DAYS),
    remindersRepository.findUpcoming(userId, today, addDays(today, REMINDER_WINDOW_DAYS)),
    prisma.alert.findMany({
      where: { userId, isRead: false, createdAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.alert.findMany({
      where: { userId, isRead: true, createdAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const candidates: AttentionCandidate[] = [];

  // One budget line, never one per category. Several overruns — the count says
  // more; a single one — the alert names the category, so it wins the topic.
  const overrunCount = summary.budget.overrunCount;
  if (overrunCount > 0) {
    candidates.push({
      id: "budget",
      icon: "🎯",
      text: overrunCount === 1 ? "חריגה בקטגוריית תקציב אחת" : `חריגה ב־${overrunCount} קטגוריות תקציב`,
      to: "/budgets",
      tone: "warning",
      source: "summary",
      topic: "budget",
      priority: overrunCount === 1 ? PRIORITY.budgetSingle : PRIORITY.budget,
    });
  }

  if (summary.bankReview.unresolvedCount > 0) {
    candidates.push({
      id: "bank-unresolved",
      icon: "🚧",
      text: `${summary.bankReview.unresolvedCount} תנועות בנק ללא סיווג — לא נספרות באף מספר`,
      to: "/accounts?tab=reconcile",
      tone: "critical",
      source: "summary",
      topic: "bank-unresolved",
      priority: PRIORITY.bankUnresolved,
    });
  } else if (summary.bankReview.pendingCount > 0) {
    candidates.push({
      id: "bank-review",
      icon: "🏦",
      text: `${summary.bankReview.pendingCount} תנועות בנק ממתינות לסיווג`,
      to: "/accounts?tab=reconcile",
      tone: "warning",
      source: "summary",
      topic: "bank-review",
      priority: PRIORITY.bankReview,
    });
  }

  // Resolved, counted, but coarse: a card bill with no itemized statement behind
  // it, or a loan received whose terms are unknown. Worth a look, not an alarm.
  if (summary.bankReview.needsAttention > 0) {
    candidates.push({
      id: "bank-coarse",
      icon: "💳",
      text:
        summary.bankMonth.unitemizedCard > 0
          ? `${formatILS(summary.bankMonth.unitemizedCard)} חיובי אשראי ללא פירוט — נספרים כהוצאה אחת`
          : `${formatILS(summary.bankMonth.loanDrawdown)} הלוואה שהתקבלה — יש להשלים את תנאי ההלוואה`,
      to: "/accounts?tab=reconcile",
      tone: "info",
      source: "summary",
      topic: "bank-coarse",
      priority: PRIORITY.bankCoarse,
    });
  }

  if (pendingImports.length > 0) {
    const pendingTx = pendingImports.reduce((sum, imp) => sum + imp.totalTransactions, 0);
    candidates.push({
      id: "credit-pending",
      icon: "💳",
      text: `${pendingTx} עסקאות אשראי ממתינות לאישור`,
      to: "/accounts?tab=credit",
      tone: "warning",
      source: "credit",
      topic: "credit-pending",
      priority: PRIORITY.creditPending,
    });
  }

  // Read alerts join the list unshown, so a dismissed fact isn't handed back
  // by the raw source that also detects it.
  const unread = [...unreadAlerts].sort((a, b) => TONE_RANK[a.severity] - TONE_RANK[b.severity]);
  for (const alert of unread) candidates.push(alertCandidate(alert, false));
  for (const alert of dismissedAlerts) candidates.push(alertCandidate(alert, true));

  const heaviest = upcoming.heaviestDay;
  if (heaviest && isHeavyDay(upcoming)) {
    candidates.push({
      id: "upcoming-heavy-day",
      icon: "📅",
      text: `${heaviest.count} חיובים בסך ${formatILS(heaviest.total)} מתרכזים ב־${formatDayMonth(new Date(heaviest.date))}`,
      to: "/manage?tab=calendar",
      tone: "warning",
      source: "upcoming",
      topic: "upcoming_payment",
      priority: PRIORITY.heavyDay,
    });
  }

  for (const reminder of reminders.slice(0, MAX_REMINDER_ITEMS)) {
    const amount = reminder.estimatedAmount ? ` — ${formatILS(decimalToNumber(reminder.estimatedAmount))}` : "";
    candidates.push({
      id: `reminder-${reminder.id}`,
      icon: reminder.icon || "🔔",
      text: `${relativeDayLabel(reminder.eventDate)}: ${reminder.title}${amount}`,
      to: "/manage?tab=calendar",
      tone: daysUntil(reminder.eventDate) <= 1 ? "warning" : "info",
      source: "reminder",
      topic: `reminder-${reminder.id}`,
      priority: PRIORITY.reminder,
    });
  }

  return candidates;
}

/** One line per topic, most urgent first. Pure — the whole merge rule in one place. */
export function mergeAttention(candidates: AttentionCandidate[]): AttentionItem[] {
  const byTopic = new Map<string, AttentionCandidate>();
  for (const candidate of candidates) {
    const current = byTopic.get(candidate.topic);
    if (!current || candidate.priority < current.priority) byTopic.set(candidate.topic, candidate);
  }

  const winners = [...byTopic.values()].filter((candidate) => !candidate.dismissed);
  winners.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.priority - b.priority);

  const items: AttentionItem[] = [];
  let alertCount = 0;
  for (const candidate of winners) {
    if (candidate.source === "alert" && ++alertCount > MAX_ALERT_ITEMS) continue;
    items.push({
      id: candidate.id,
      icon: candidate.icon,
      text: candidate.text,
      to: candidate.to,
      tone: candidate.tone,
    });
  }
  return items;
}

export async function buildAttention(userId: number, year: number, month: number): Promise<AttentionItem[]> {
  return mergeAttention(await collectAttentionCandidates(userId, year, month));
}
