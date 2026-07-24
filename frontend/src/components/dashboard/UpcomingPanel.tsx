import type { Upcoming } from "../../types/models";
import { formatCurrency } from "../../utils/format";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(d) - startOfDay(today)) / 86400000);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" });
}

/** Forward-looking agenda of upcoming charges — surfaces pressure before it lands. */
export function UpcomingPanel({ data }: { data: Upcoming }) {
  if (data.events.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">📅 מה צפוי בקרוב</span>
        </div>
        <div className="text-muted" style={{ fontSize: 14 }}>
          אין תשלומים קבועים, מנויים או החזרי הלוואות ב-{data.windowDays} הימים הקרובים.
        </div>
      </div>
    );
  }

  // Group by calendar day, preserving chronological order.
  const groups: { key: string; iso: string; events: Upcoming["events"] }[] = [];
  for (const event of data.events) {
    const key = event.date.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(event);
    else groups.push({ key, iso: event.date, events: [event] });
  }

  const heaviestKey = data.heaviestDay?.date.slice(0, 10);

  return (
    <div className="card upcoming-panel">
      <div className="card-header">
        <span className="card-title">📅 מה צפוי ב-{data.windowDays} הימים הקרובים</span>
        <span className="upcoming-total">
          סה״כ <strong className="mono">{formatCurrency(data.total)}</strong>
        </span>
      </div>

      {data.heaviestDay && data.heaviestDay.count > 1 && (
        <div className="upcoming-pressure">
          ⚠️ יום עמוס: ב-{dayLabel(data.heaviestDay.date)} מצטברים {data.heaviestDay.count} חיובים בסך{" "}
          {formatCurrency(data.heaviestDay.total)} — כדאי לוודא שיש כיסוי.
        </div>
      )}

      <ul className="upcoming-list">
        {groups.map((group) => (
          <li key={group.key} className={`upcoming-day ${group.key === heaviestKey ? "upcoming-day-heavy" : ""}`}>
            <div className="upcoming-day-head">{dayLabel(group.iso)}</div>
            {group.events.map((event, i) => (
              <div key={i} className="upcoming-event">
                <span className="upcoming-event-icon" aria-hidden>
                  {event.icon}
                </span>
                <span className="upcoming-event-name">{event.name}</span>
                <span className="upcoming-event-amount mono">{formatCurrency(event.amount)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
