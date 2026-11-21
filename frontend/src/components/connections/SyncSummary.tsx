import { Link } from "react-router-dom";
import type { ConnectionSync, SyncOutcomeItem, SyncStageState } from "../../types/models";
import { formatCurrency, formatDate } from "../../utils/format";
import { awaitsReview, groupStages, isAccountItem, isLoanSchedule, isSiteSnapshot, milestones, REVIEWABLE, STAGE_GROUP_TITLE, STAGE_STATUS_LABEL, stageText, syncStages } from "./syncPhases";

const DROPPED = ["cancelled", "rolled_back", "failed"];
const transactions = (n: number) => (n === 1 ? "תנועה אחת" : `${n} תנועות`);

function counts(item: SyncOutcomeItem): string[] {
  const lines: string[] = [];
  const review = item.review;
  if (review && DROPPED.includes(review.status)) lines.push("הייבוא הזה בוטל — לא נוסף ממנו דבר");
  else if (review) {
    const done = review.status === "completed" || review.status === "review";
    lines.push(`${done ? "נוספו" : "ייכנסו באישור"}: ${review.counts.included}`);
    if (review.counts.duplicate) lines.push(`כבר רשומות: ${review.counts.duplicate}`);
    if (review.counts.pending) lines.push(`מחכות להחלטה שלך: ${review.counts.pending}`);
  }
  if (item.skippedPending) lines.push(`בתהליך אצל הבנק, ייקלטו ברענון הבא: ${item.skippedPending}`);
  if (item.skippedZero) lines.push(`בסכום 0, לא נוספו: ${item.skippedZero}`);
  return lines;
}

// Synced bank rows carry no running balance; the site's balance is the completeness check (banker).
function BalanceCheck({ item }: { item: SyncOutcomeItem }) {
  if (item.siteBalance == null) return null;
  const exact = (amount: number) => <span dir="ltr">{formatCurrency(amount, { exact: true })}</span>;
  const check = item.balanceCheck;
  const site = <>יתרה לפי אתר הבנק בזמן הרענון: {exact(item.siteBalance)}</>;
  if (!check) return <p className="text-muted">{site}</p>;
  const asOf = formatDate(check.asOf);
  if (check.status === "unknown") return <p className="text-muted">{site}. לא ניתן להשוות — יתרת הפתיחה אצלנו לא ידועה. אפשר להזין את היתרה מהבנק במסך החשבון.</p>;
  if (check.status === "circular") return <p className="text-muted">{site}. היתרה אצלנו נקבעה לפי אותה יתרה מהאתר, ולכן זו לא בדיקה שהתנועות שלמות.</p>;
  if (check.status === "match") return <p className="text-muted">היתרה אצלנו נכון ל־{asOf} תואמת את אתר הבנק: {exact(item.siteBalance)}</p>;
  return (
    <p className="connection-state connection-state-waiting">
      לפי אתר הבנק {exact(item.siteBalance)}, אצלנו נכון ל־{asOf} {exact(check.ourBalance!)} (פער {exact(check.gap!)}).
      {" "}ייתכן שחסרות תנועות או שיש תנועות שעדיין בתהליך אצל הבנק.
    </p>
  );
}

function ForeignRows({ item }: { item: SyncOutcomeItem }) {
  if (!item.skippedForeign) return null;
  const listed = item.foreign ?? [];
  return (
    <details className="sync-foreign">
      <summary>{item.skippedForeign === 1 ? "תנועה אחת במטבע זר לא נוספה" : `${transactions(item.skippedForeign)} במטבע זר לא נוספו`} (הסכומים לא בשקלים). אפשר להוסיף {item.skippedForeign === 1 ? "אותה" : "אותן"} מקובץ הכרטיס.</summary>
      <ul>
        {listed.map((row, index) => (
          <li key={`${row.date}-${index}`}>
            {formatDate(row.date)} · {row.description} · {row.originalAmount > 0 ? "זיכוי " : ""}<span dir="ltr">{Math.abs(row.originalAmount)} {row.originalCurrency}</span>
            {row.chargedAmount !== null && row.chargedCurrency && row.chargedCurrency !== row.originalCurrency && <> · חויב <span dir="ltr">{Math.abs(row.chargedAmount)} {row.chargedCurrency}</span></>}
          </li>
        ))}
      </ul>
      {item.skippedForeign > listed.length && <p className="text-muted">ועוד {item.skippedForeign - listed.length}</p>}
    </details>
  );
}

const STAGE_MARK: Record<SyncStageState, string> = { done: "✓", partial: "◐", skipped: "–", blocked: "⊘", failed: "✕" };

// Only "done" is styled as success; blocked and failed get the same attention as a balance gap.
function SyncStages({ sync }: { sync: ConnectionSync }) {
  const stages = syncStages(sync);
  if (!stages.length) return null;
  return (
    <section className="sync-stages" aria-label="שלבי הסנכרון">
      {groupStages(stages).map(({ group, stages: lines }) => (
        <div key={group} className="sync-stage-group">
          <h4 className="sync-stage-group-title">{STAGE_GROUP_TITLE[group]}</h4>
          <ul className="sync-stage-list" aria-label={STAGE_GROUP_TITLE[group]}>
            {lines.map((s) => (
              <li key={s.stage} className={`sync-stage sync-stage-${s.state}${s.state === "blocked" || s.state === "failed" ? " connection-state-waiting" : ""}`}>
                <span className="sync-stage-mark" aria-hidden="true">{STAGE_MARK[s.state]}</span>
                <span className="sync-stage-text">{stageText(s)}</span>
                {/* A server older than statuses sends none; the text stands alone rather than a guessed status. */}
                {s.status && <span className={`sync-stage-status sync-stage-status-${s.status}`}><span className="sr-only">מצב: </span>{STAGE_STATUS_LABEL[s.status]}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const reviewLink = (item: SyncOutcomeItem) => item.importSessionId && REVIEWABLE.includes(item.review?.status ?? "")
  ? <Link className="btn btn-primary btn-sm" to={`/imports?session=${item.importSessionId}`} aria-label={`לבדיקה ואישור: ${item.target}`}>לבדיקה ואישור</Link>
  : null;

/** Imports beside the account rows (a schedule, the bank site's figures): approved on the import screen too. */
function SideImports({ title, items }: { title: string; items: SyncOutcomeItem[] }) {
  if (!items.length) return null;
  return (
    <section className="sync-schedules" aria-label={title}>
      <h4>{title}</h4>
      <ul className="sync-summary-list">
        {items.map((item) => (
          <li key={item.key} className="sync-summary-item">
            <strong>{item.target}</strong>
            {item.review && DROPPED.includes(item.review.status) && <p className="text-muted">הייבוא הזה בוטל — לא נוסף ממנו דבר</p>}
            {item.note && <p className="text-muted">{item.note}</p>}
            {reviewLink(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Counts only, never sums: until she approves, nothing is income, expense or balance (banker).
 * The counts are the import screen's own — the review happens there, not here.
 */
export function SyncSummary({ sync }: { sync: ConnectionSync }) {
  const all = sync.outcome ?? [];
  const outcome = all.filter(isAccountItem);
  const schedules = all.filter(isLoanSchedule);
  const snapshots = all.filter(isSiteSnapshot);
  const awaiting = awaitsReview(sync);
  const { approved } = milestones(sync);
  return (
    <div className="sync-summary">
      {/* The server's message is a snapshot from when the sync ended; once approved it would contradict the page. */}
      {!awaiting && !approved && sync.message && <p className="text-muted">{sync.message}</p>}
      <SyncStages sync={sync} />
      {outcome.length === 0 && <p className="text-muted">לא נמצאו חשבונות בכניסה הזו.</p>}
      <SideImports title="לוחות סילוקין לאישור" items={schedules} />
      <SideImports title="פרטים מאתר הבנק לאישור" items={snapshots} />

      <ul className="sync-summary-list">
        {outcome.map((item) => (
          <li key={item.key} className="sync-summary-item">
            <strong>{item.target}</strong>
            {counts(item).length > 0 && <ul className="sync-counts">{counts(item).map((line) => <li key={line}>{line}</li>)}</ul>}
            {item.note && <p className="text-muted">{item.note}</p>}
            <BalanceCheck item={item} />
            <ForeignRows item={item} />
            {reviewLink(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}
