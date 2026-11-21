import type { DetectedCommitment } from "../../types/journey.types";
import { formatCurrency } from "../../utils/format";
import { DropZone } from "./DropZone";

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
      {hasLoan && <p className="text-muted">יתרת ההלוואה והריבית לא מופיעות בדף החשבון. ההחזר החודשי ייכנס לתזרים, והיתרה תתעדכן כשיועלה לוח הסילוקין שלה — מיד אחרי ההוספה אפשר להעלות אותו כאן.</p>}
    </fieldset>
  );
}

export function AddedCommitments({ items }: { items: DetectedCommitment[] }) {
  if (!items.length) return null;
  return <p role="status">נוספו להתחייבויות: {items.map((c) => `${c.name} (${formatCurrency(c.amount)} בחודש)`).join(" · ")}</p>;
}

/** The statement only shows the repayment; the schedule carries balance and interest, so ask for it right here. */
export function LoanScheduleNext({ items, onFile, busy, error }: { items: DetectedCommitment[]; onFile: (file: File) => void; busy: boolean; error?: string }) {
  const loans = items.filter((c) => c.kind === "loan");
  if (!loans.length) return null;
  const names = loans.map((c) => (c.loanNumber ? `הלוואה ${c.loanNumber}` : "ההלוואה")).join(", ");
  return (
    <div className="loan-schedule-next">
      <p>
        <strong>הצעד הבא: לוח הסילוקין של {names}.</strong> באתר הבנק, בעמוד ההלוואה, מורידים את הלוח כקובץ Excel ומעלים אותו כאן.
        הלוח ישויך להלוואה לפי המספר שבו, ויעבור אישור כמו כל דוח.
      </p>
      <DropZone onFile={onFile} busy={busy} accept=".xlsx,.xls" icon="📉" title="גררי לכאן את קובץ לוח הסילוקין, או לחצי לבחירה" hint="הקובץ שהבנק מייצא מעמוד ההלוואה" />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
