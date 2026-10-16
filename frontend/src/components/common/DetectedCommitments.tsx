import type { DetectedCommitment } from "../../types/journey.types";
import { formatCurrency } from "../../utils/format";

function describe(c: DetectedCommitment): string {
  const when = `ב־${c.dayOfMonth} לחודש, ${c.months} חודשים בדוח`;
  return c.kind === "loan"
    ? `זוהתה הלוואה${c.loanNumber ? ` (${c.loanNumber})` : ""} עם החזר חודשי של ${formatCurrency(c.amount)} — ${when}`
    : `זוהה תשלום קבוע: ${c.name} — ${formatCurrency(c.amount)} בחודש, ${when}`;
}

interface Props {
  items: DetectedCommitment[];
  skipped: Set<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}

/** Offered pre-checked: the statement already proves them, the user only removes what is wrong. */
export function DetectedCommitments({ items, skipped, onToggle, disabled }: Props) {
  if (!items.length) return null;
  const hasLoan = items.some((c) => c.kind === "loan");
  return (
    <fieldset className="detected-commitments">
      <legend>זיהינו בדוח {items.length} חיובים קבועים. הם יתווספו להתחייבויות יחד עם התנועות</legend>
      {items.map((c) => (
        <label key={c.key} className="household-consent">
          <input type="checkbox" checked={!skipped.has(c.key)} disabled={disabled} onChange={() => onToggle(c.key)} />
          {describe(c)}
        </label>
      ))}
      {hasLoan && <p className="text-muted">יתרת ההלוואה והריבית לא מופיעות בדף החשבון. ההחזר החודשי ייכנס לתזרים, והיתרה תתעדכן כשיועלה לוח הסילוקין שלה.</p>}
    </fieldset>
  );
}

export function AddedCommitments({ items }: { items: DetectedCommitment[] }) {
  if (!items.length) return null;
  return <p role="status">נוספו להתחייבויות: {items.map((c) => `${c.name} (${formatCurrency(c.amount)} בחודש)`).join(" · ")}</p>;
}
