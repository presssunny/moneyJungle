import { useMemo, useState } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { PageShell } from "../components/common/PageShell";
import { SkeletonChart, SkeletonKpiRow } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { ReminderForm } from "../components/reminders/ReminderForm";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { getCommitmentsMonth } from "../services/journey.service";
import { amountBasisNote, formatCurrency, formatKnownSum } from "../utils/format";

interface CalendarEvent {
  key: string;
  day: number;
  icon: string;
  title: string;
  amount: number | null;
  kind: string;
  basisNote: string | null;
}

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const KIND_ICON: Record<string, string> = { recurring: "🔁", subscription: "📺", loan: "📉", reminder: "🔔", credit: "💳" };

export default function CalendarPage() {
  const { year, month, monthKey } = useMonth();
  const [reminderOpen, setReminderOpen] = useState(false);

  // The month comes from the same list as the agenda (server): totals and the busiest day are not added up here.
  const schedule = useAsync(() => getCommitmentsMonth(monthKey), [monthKey], "לא הצלחנו לטעון את אירועי החודש");

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const event of schedule.data?.events ?? []) {
      const day = Number(event.date.slice(8, 10));
      map.set(day, [...(map.get(day) ?? []), { key: event.key, day, icon: KIND_ICON[event.kind] ?? "📌", title: event.name, amount: event.amount, kind: event.kind,
        basisNote: event.basis ? amountBasisNote(event.basis) : null }]);
    }
    return map;
  }, [schedule.data]);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const monthTotal = schedule.data?.total ?? { knownTotal: 0, unknownCount: 0 };
  const heaviest = schedule.data?.heaviestDay ? { day: Number(schedule.data.heaviestDay.date.slice(8, 10)), total: schedule.data.heaviestDay.total } : null;
  const eventCount = schedule.data?.events.length ?? 0;

  const cells: Array<{ day: number | null }> = [
    ...Array.from({ length: firstWeekday }, () => ({ day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
  ];


  return (
    <PageShell
      toolbar={<Button onClick={() => setReminderOpen(true)}>+ תזכורת</Button>}
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
                value={formatKnownSum(monthTotal)}
                icon="📅"
                tone="danger"
                sub={`${eventCount} אירועים`}
                footnote={schedule.data?.possibleCardOverlap ? "ייתכן שתשלום קבוע בכרטיס כלול גם בחיוב הכרטיס" : undefined}
              />
              <SummaryCard
                label="היום העמוס"
                value={heaviest ? `${heaviest.day} בחודש` : "—"}
                icon="⚠️"
                tone={heaviest ? "warning" : "default"}
                sub={heaviest ? formatKnownSum(heaviest.total) : undefined}
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
              hint="תשלומים קבועים, מנויים, הלוואות, חיובי כרטיס ותזכורות יופיעו כאן לפי התאריך שלהם"
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
                          <span className="mono calendar-event-amount">{event.amount === null ? "סכום לא ידוע" : formatCurrency(event.amount)}{event.basisNote && ` · ${event.basisNote}`}</span>
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
        <span><span className="calendar-dot calendar-event-loan" /> הלוואות</span>
        <span><span className="calendar-dot calendar-event-credit" /> חיובי כרטיס</span>
      </div>

      <ReminderForm open={reminderOpen} onClose={() => setReminderOpen(false)} onSaved={() => void schedule.reload()} />
    </PageShell>
  );
}
