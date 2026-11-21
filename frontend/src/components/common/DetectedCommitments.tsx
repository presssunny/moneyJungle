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
  accepted: Set<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}

/** Offered unmarked: approving the statement adds only what she marks; the rest waits for the next statement. */
export function DetectedCommitments({ items, accepted, onToggle, disabled }: Props) {
  if (!items.length) return null;
  const hasLoan = items.some((c) => c.kind === "loan");
  return (
    <fieldset className="detected-commitments">
      <legend>זיהינו בדוח {items.length} חיובים קבועים. סמני את מה שלהוסיף להתחייבויות — מה שלא יסומן לא יתווסף עכשיו, ויוצע שוב בדוח הבא.</legend>
      {items.map((c) => (
        <label key={c.key} className="household-consent">
          <input type="checkbox" checked={accepted.has(c.key)} disabled={disabled} onChange={() => onToggle(c.key)} />
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
