import { Link } from "react-router-dom";
import type { ConnectionSync, SyncOutcomeItem } from "../../types/models";
import { formatCurrency, formatDate } from "../../utils/format";
import { awaitsReview, milestones, REVIEWABLE } from "./syncPhases";

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
  if (item.balanceUnknown) return <p className="text-muted">יתרה לפי אתר הבנק בזמן הרענון: {exact(item.siteBalance)}. לא ניתן להשוות — יתרת הפתיחה אצלנו לא ידועה. אפשר להזין את היתרה מהבנק במסך החשבון.</p>;
  if (item.ourBalance == null) return <p className="text-muted">יתרה לפי אתר הבנק בזמן הרענון: {exact(item.siteBalance)}</p>;
  const gap = Math.round((item.ourBalance - item.siteBalance) * 100) / 100;
  if (gap === 0) return <p className="text-muted">היתרה אצלנו תואמת את אתר הבנק: {exact(item.siteBalance)}</p>;
  return (
    <p className="connection-state connection-state-waiting">
      לפי אתר הבנק {exact(item.siteBalance)}, אצלנו {exact(item.ourBalance)}.
      {" "}ייתכן שחסרות תנועות, שיש תנועות שעדיין בתהליך אצל הבנק, או שנוספו תנועות אחרי הרענון.
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

/**
 * Counts only, never sums: until she approves, nothing is income, expense or balance (banker).
 * The counts are the import screen's own — the review happens there, not here.
 */
export function SyncSummary({ sync }: { sync: ConnectionSync }) {
  const outcome = sync.outcome ?? [];
  const awaiting = awaitsReview(sync);
  const { approved } = milestones(sync);
  return (
    <div className="sync-summary">
      {/* The server's message is a snapshot from when the sync ended; once approved it would contradict the page. */}
      {!awaiting && !approved && sync.message && <p className="text-muted">{sync.message}</p>}
      {outcome.length === 0 && <p className="text-muted">לא נמצאו חשבונות בכניסה הזו.</p>}
      <ul className="sync-summary-list">
        {outcome.map((item) => (
          <li key={item.key} className="sync-summary-item">
            <strong>{item.target}</strong>
            {counts(item).length > 0 && <ul className="sync-counts">{counts(item).map((line) => <li key={line}>{line}</li>)}</ul>}
            {item.note && <p className="text-muted">{item.note}</p>}
            <BalanceCheck item={item} />
            <ForeignRows item={item} />
            {item.importSessionId && REVIEWABLE.includes(item.review?.status ?? "") && <Link className="btn btn-primary btn-sm" to={`/imports?session=${item.importSessionId}`} aria-label={`לבדיקה ואישור: ${item.target}`}>לבדיקה ואישור</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
