import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/common/Card";
import { Loading } from "../components/common/Loading";
import { useMonth } from "../context/MonthContext";
import { listReminders } from "../services/reminders.service";
import { listRecurring, listSubscriptions } from "../services/planning.service";
import type { Reminder } from "../types/dashboard.types";
import type { RecurringPayment, Subscription } from "../types/models";
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
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [recurring, setRecurring] = useState<RecurringPayment[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);

  useEffect(() => {
    listReminders().then(setReminders).catch(() => setReminders([]));
    listRecurring().then((d) => setRecurring(d.items)).catch(() => setRecurring([]));
    listSubscriptions().then((d) => setSubscriptions(d.items)).catch(() => setSubscriptions([]));
  }, []);

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

  if (!reminders || !recurring || !subscriptions) return <Loading />;

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const monthTotal = [...eventsByDay.values()].flat().reduce((sum, e) => sum + (e.amount ?? 0), 0);

  const cells: Array<{ day: number | null }> = [
    ...Array.from({ length: firstWeekday }, () => ({ day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
  ];

  return (
    <>
      <div className="page-toolbar">
        <div className="toolbar-total">
          תשלומים ואירועים צפויים החודש: <strong className="mono">{formatCurrency(monthTotal)}</strong>
        </div>
      </div>

      <Card>
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
      </Card>

      <div className="calendar-legend">
        <span><span className="calendar-dot calendar-event-reminder" /> תזכורות</span>
        <span><span className="calendar-dot calendar-event-recurring" /> תשלומים קבועים</span>
        <span><span className="calendar-dot calendar-event-subscription" /> מנויים</span>
      </div>
    </>
  );
}
