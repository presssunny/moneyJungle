import { useMemo } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { PageShell } from "../components/common/PageShell";
import { SkeletonChart, SkeletonKpiRow } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { listReminders } from "../services/reminders.service";
import { listRecurring, listSubscriptions } from "../services/planning.service";
import { formatCurrency } from "../utils/format";

interface CalendarEvent {
  key: string;
  day: number;
  icon: string;
  title: string;
  amount: number | null;
  kind: "reminder" | "recurring" | "subscription";
}

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export default function CalendarPage() {
  const { year, month } = useMonth();

  // One resource for the whole calendar: a month drawn from two of the three
  // sources would be silently wrong ("nothing scheduled" when in fact a request
  // failed), so the grid is shown only when all three arrived.
  const schedule = useAsync(
    async () => {
      const [reminders, recurring, subscriptions] = await Promise.all([
        listReminders(),
        listRecurring(),
        listSubscriptions(),
      ]);
      return { reminders, recurring: recurring.items, subscriptions: subscriptions.items };
    },
    [],
    "לא הצלחנו לטעון את אירועי החודש"
  );
  const reminders = schedule.data?.reminders;
  const recurring = schedule.data?.recurring;
  const subscriptions = schedule.data?.subscriptions;

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    const push = (event: CalendarEvent) => {
      if (event.day < 1 || event.day > daysInMonth) return;
      const list = map.get(event.day) ?? [];
      list.push(event);
      map.set(event.day, list);
    };

    for (const reminder of reminders ?? []) {
      if (!reminder.isActive) continue;
      const date = new Date(reminder.eventDate);
      if (date.getFullYear() === year && date.getMonth() + 1 === month) {
        push({
          key: `reminder-${reminder.id}`,
          day: date.getDate(),
          icon: reminder.icon ?? "🔔",
          title: reminder.title,
          amount: reminder.estimatedAmount !== null ? Number(reminder.estimatedAmount) : null,
          kind: "reminder",
        });
      }
    }

    for (const payment of recurring ?? []) {
      // Monthly payments recur on the same day every month; other frequencies only on their date
      const date = new Date(payment.nextPaymentDate);
      const inMonth = date.getFullYear() === year && date.getMonth() + 1 === month;
      if (payment.frequency === "monthly" || inMonth) {
        push({
          key: `recurring-${payment.id}`,
          day: Math.min(date.getDate(), daysInMonth),
          icon: payment.category?.icon ?? "🔁",
          title: payment.name,
          amount: Number(payment.amount),
          kind: "recurring",
        });
      }
    }

    for (const subscription of subscriptions ?? []) {
      if (subscription.status !== "active") continue;
      const date = new Date(subscription.billingDate);
      const inMonth = date.getFullYear() === year && date.getMonth() + 1 === month;
      if (subscription.frequency === "monthly" || inMonth) {
        push({
          key: `subscription-${subscription.id}`,
          day: Math.min(date.getDate(), daysInMonth),
          icon: "📺",
          title: subscription.name,
          amount: Number(subscription.amount),
          kind: "subscription",
        });
      }
    }

    return map;
  }, [reminders, recurring, subscriptions, year, month, daysInMonth]);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const monthTotal = [...eventsByDay.values()].flat().reduce((sum, e) => sum + (e.amount ?? 0), 0);

  const cells: Array<{ day: number | null }> = [
    ...Array.from({ length: firstWeekday }, () => ({ day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
  ];

  // The heaviest day of the month — the one worth planning around.
  const heaviest = [...eventsByDay.entries()]
    .map(([day, events]) => ({ day, total: events.reduce((sum, e) => sum + (e.amount ?? 0), 0) }))
    .sort((a, b) => b.total - a.total)[0];
  const eventCount = [...eventsByDay.values()].flat().length;

  return (
    <PageShell
      summary={
        <AsyncSection
          resource={schedule}
          errorTitle="לא הצלחנו לטעון את סיכום החודש"
          skeleton={<SkeletonKpiRow count={3} label="טוען סיכום" />}
        >
          {() => (
            <div className="kpi-row">
              <SummaryCard
                label="צפוי לצאת החודש"
                value={formatCurrency(monthTotal)}
                icon="📅"
                tone="danger"
                sub={`${eventCount} אירועים`}
              />
              <SummaryCard
                label="היום העמוס"
                value={heaviest ? `${heaviest.day} בחודש` : "—"}
                icon="⚠️"
                tone={heaviest ? "warning" : "default"}
                sub={heaviest ? formatCurrency(heaviest.total) : undefined}
              />
              <SummaryCard
                label="ימים עם תשלומים"
                value={String(eventsByDay.size)}
                icon="🗓️"
                sub={`מתוך ${daysInMonth}`}
              />
            </div>
          )}
        </AsyncSection>
      }
    >
      <Card>
        <AsyncSection
          resource={schedule}
          errorTitle="לא הצלחנו לטעון את אירועי החודש"
          skeleton={<SkeletonChart height={320} label="טוען את לוח החודש" />}
          isEmpty={() => eventsByDay.size === 0}
          emptyState={
            <EmptyState
              icon="📅"
              title="אין אירועים בחודש הזה"
              hint="תשלומים קבועים, מנויים ותזכורות שתגדירי יופיעו כאן לפי התאריך שלהם"
            />
          }
        >
          {() => (
            <div className="calendar-grid">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="calendar-weekday">{weekday}</div>
              ))}
              {cells.map((cell, index) =>
                cell.day === null ? (
                  <div key={`empty-${index}`} className="calendar-cell calendar-cell-empty" />
                ) : (
                  <div
                    key={cell.day}
                    className={`calendar-cell ${isCurrentMonth && cell.day === today.getDate() ? "calendar-cell-today" : ""}`}
                  >
                    <span className="calendar-day-number">{cell.day}</span>
                    <div className="calendar-events">
                      {(eventsByDay.get(cell.day) ?? []).map((event) => (
                        <div key={event.key} className={`calendar-event calendar-event-${event.kind}`} title={event.title}>
                          <span>{event.icon}</span>
                          <span className="calendar-event-title">{event.title}</span>
                          {event.amount !== null && <span className="mono calendar-event-amount">{formatCurrency(event.amount)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </AsyncSection>
      </Card>

      <div className="calendar-legend">
        <span><span className="calendar-dot calendar-event-reminder" /> תזכורות</span>
        <span><span className="calendar-dot calendar-event-recurring" /> תשלומים קבועים</span>
        <span><span className="calendar-dot calendar-event-subscription" /> מנויים</span>
      </div>
    </PageShell>
  );
}
