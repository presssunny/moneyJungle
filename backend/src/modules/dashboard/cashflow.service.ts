import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";

/**
 * Forward-looking cash-flow: projects dated obligations (recurring payments,
 * subscriptions, loan installments, reminders) across the next N days so the user
 * can see pressure BEFORE it arrives — "on the 15th three charges land together".
 * All computed on the fly from existing data; no new tables.
 */

export type UpcomingKind = "recurring" | "subscription" | "loan" | "reminder";

export interface UpcomingEvent {
  date: string; // ISO date
  kind: UpcomingKind;
  name: string;
  amount: number;
  icon: string;
}

export interface UpcomingResponse {
  windowDays: number;
  from: string;
  to: string;
  total: number;
  events: UpcomingEvent[];
  heaviestDay: { date: string; total: number; count: number } | null;
}

const KIND_ICON: Record<UpcomingKind, string> = {
  recurring: "🔁",
  subscription: "📺",
  loan: "📉",
  reminder: "🔔",
};

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Monthly occurrences on the anchor's day-of-month (clamped) within [from, to]. */
function monthlyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const day = anchor.getUTCDate();
  const res: Date[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  for (let i = 0; i < 18; i++) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m, Math.min(day, daysInMonth)));
    if (d >= from && d <= to) res.push(d);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return res;
}

/** Yearly occurrence(s) on the anchor's month+day within [from, to]. */
function yearlyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const res: Date[] = [];
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear() + 1; y++) {
    const d = new Date(Date.UTC(y, anchor.getUTCMonth(), anchor.getUTCDate()));
    if (d >= from && d <= to) res.push(d);
  }
  return res;
}

/** Weekly occurrences stepping 7 days from the anchor's weekday within [from, to]. */
function weeklyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const res: Date[] = [];
  const d = new Date(anchor);
  let guard = 0;
  while (d < from && guard < 400) {
    d.setUTCDate(d.getUTCDate() + 7);
    guard += 1;
  }
  while (d <= to && guard < 400) {
    res.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 7);
    guard += 1;
  }
  return res;
}

export async function buildUpcoming(userId: number, windowDays: number): Promise<UpcomingResponse> {
  const from = todayUTC();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + windowDays);

  const [recurrings, subscriptions, loans, reminders] = await Promise.all([
    prisma.recurringPayment.findMany({ where: { userId } }),
    prisma.subscription.findMany({ where: { userId, status: "active" } }),
    prisma.loan.findMany({ where: { userId, status: "active" } }),
    prisma.reminder.findMany({
      where: { userId, isActive: true, eventDate: { gte: from, lte: to } },
    }),
  ]);

  const events: UpcomingEvent[] = [];

  for (const r of recurrings) {
    const amount = decimalToNumber(r.amount);
    const anchor = new Date(r.nextPaymentDate);
    const dates =
      r.frequency === "weekly"
        ? weeklyOccurrences(anchor, from, to)
        : r.frequency === "yearly"
          ? yearlyOccurrences(anchor, from, to)
          : monthlyOccurrences(anchor, from, to);
    for (const d of dates) {
      events.push({ date: d.toISOString(), kind: "recurring", name: r.name, amount, icon: KIND_ICON.recurring });
    }
  }

  for (const s of subscriptions) {
    const amount = decimalToNumber(s.amount);
    const anchor = new Date(s.billingDate);
    const dates = s.frequency === "yearly" ? yearlyOccurrences(anchor, from, to) : monthlyOccurrences(anchor, from, to);
    for (const d of dates) {
      events.push({ date: d.toISOString(), kind: "subscription", name: s.name, amount, icon: KIND_ICON.subscription });
    }
  }

  for (const loan of loans) {
    const amount = decimalToNumber(loan.monthlyPayment);
    if (amount <= 0) continue;
    const balance = decimalToNumber(loan.currentBalance);
    if (balance <= 0) continue;
    const endDate = loan.endDate ? new Date(loan.endDate) : null;
    const dates = monthlyOccurrences(new Date(loan.startDate), from, to);
    for (const d of dates) {
      if (endDate && d > endDate) continue;
      events.push({
        date: d.toISOString(),
        kind: "loan",
        name: loan.loanName,
        amount,
        icon: KIND_ICON.loan,
      });
    }
  }

  for (const rem of reminders) {
    events.push({
      date: new Date(rem.eventDate).toISOString(),
      kind: "reminder",
      name: rem.title,
      amount: rem.estimatedAmount != null ? decimalToNumber(rem.estimatedAmount) : 0,
      icon: rem.icon || KIND_ICON.reminder,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Heaviest single day — the "pressure" moment worth warning about.
  const byDay = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const key = e.date.slice(0, 10);
    const agg = byDay.get(key) ?? { total: 0, count: 0 };
    agg.total += e.amount;
    agg.count += 1;
    byDay.set(key, agg);
  }
  let heaviestDay: UpcomingResponse["heaviestDay"] = null;
  for (const [date, agg] of byDay) {
    if (!heaviestDay || agg.total > heaviestDay.total) {
      heaviestDay = { date: `${date}T00:00:00.000Z`, total: round2(agg.total), count: agg.count };
    }
  }

  return {
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    total: round2(events.reduce((sum, e) => sum + e.amount, 0)),
    events,
    heaviestDay,
  };
}
