import { useState } from "react";
import type { MonthProgress } from "../../services/finance.service";
import { formatCurrency } from "../../utils/format";
import { Button } from "../common/Button";
import { Input } from "../common/Input";

/**
 * Compact "how is the month going" panel for the Expenses page.
 *
 * Follows budgeting-UX conventions: a spent-vs-target bar with a *pace* marker
 * (where you should be by today), an end-of-month forecast at the current burn
 * rate, and an encouraging status — celebrate on-track, warn early, never shame.
 */
export function MonthProgressPanel({
  progress,
  onSaveTarget,
}: {
  progress: MonthProgress;
  onSaveTarget: (value: number | null) => Promise<void>;
}) {
  const { spent, target, targetSource, isCurrentMonth, isFuture, daysInMonth, dayOfMonth, daysLeft, projected } =
    progress;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(progress.goal ?? ""));
  const [saving, setSaving] = useState(false);

  async function save(value: number | null) {
    setSaving(true);
    try {
      await onSaveTarget(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // Where you'd be if you spent evenly toward the target by today.
  const elapsedPct = daysInMonth > 0 ? (dayOfMonth / daysInMonth) * 100 : 100;
  const spentPct = target && target > 0 ? Math.min(100, (spent / target) * 100) : 0;
  const overTarget = target != null && (projected ?? spent) > target;

  // Status: compare the forecast (current month) or actual (finished month) to target.
  const outcome = projected ?? spent;
  let tone: "good" | "warning" | "bad" = "good";
  let statusText = "";
  if (target == null) {
    tone = "good";
    statusText = "הגדירי יעד חודשי כדי לראות אם את בקצב";
  } else if (spent > target) {
    tone = "bad";
    statusText = `חרגת מהיעד ב-${formatCurrency(spent - target)}`;
  } else if (outcome > target * 1.1) {
    tone = "bad";
    statusText = isCurrentMonth ? "בקצב הזה צפויה חריגה מהיעד" : "חריגה מהיעד";
  } else if (outcome > target) {
    tone = "warning";
    statusText = isCurrentMonth ? "שימי לב — הקצב מעט מעל היעד" : "מעט מעל היעד";
  } else {
    tone = "good";
    statusText = isCurrentMonth ? "יופי, את בתוך היעד 🎉" : "נשארת בתוך היעד 🎉";
  }

  const targetLabel =
    targetSource === "goal" ? "יעד חודשי" : targetSource === "last_month" ? "יעד (לפי חודש קודם)" : "יעד";

  return (
    <div className={`progress-panel tone-border-${tone}`}>
      <div className="progress-panel-top">
        <div>
          <div className="progress-panel-title">התקדמות החודש</div>
          <div className="progress-panel-spent">
            <span className="mono">{formatCurrency(spent)}</span>
            {target != null && <span className="text-muted"> מתוך {formatCurrency(target)}</span>}
          </div>
        </div>
        <div className="progress-panel-target">
          {editing ? (
            <div className="progress-target-edit">
              <Input
                type="number"
                min="0"
                step="50"
                placeholder="יעד ₪"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <Button size="sm" disabled={saving} onClick={() => save(draft ? Number(draft) : null)}>
                שמירה
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
                ביטול
              </Button>
              {progress.goal != null && (
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(null)}>
                  איפוס
                </Button>
              )}
            </div>
          ) : (
            <button className="linklike" onClick={() => { setDraft(String(progress.goal ?? "")); setEditing(true); }}>
              {targetLabel}: {target != null ? formatCurrency(target) : "הגדרה"} ✏️
            </button>
          )}
        </div>
      </div>

      {target != null && (
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={Math.round(spentPct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={`progress-fill tone-fill-${overTarget ? "bad" : tone}`} style={{ width: `${spentPct}%` }} />
          {isCurrentMonth && (
            <span
              className="progress-pace"
              style={{ insetInlineStart: `${Math.min(100, elapsedPct)}%` }}
              title={`קצב צפוי להיום: ${formatCurrency((target * dayOfMonth) / daysInMonth)}`}
            />
          )}
        </div>
      )}

      <div className={`progress-status tone-${tone}`}>{statusText}</div>

      <div className="progress-panel-facts">
        {isCurrentMonth ? (
          <>
            <span>חלפו {dayOfMonth} מתוך {daysInMonth} ימים · נותרו {daysLeft}</span>
            {projected != null && (
              <span className="progress-forecast">
                תחזית לסוף החודש: <strong className="mono">{formatCurrency(projected)}</strong>
              </span>
            )}
          </>
        ) : isFuture ? (
          <span>החודש עוד לא התחיל</span>
        ) : (
          <span>החודש הסתיים · סה״כ {formatCurrency(spent)}</span>
        )}
      </div>
    </div>
  );
}
