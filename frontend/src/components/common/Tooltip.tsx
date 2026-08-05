import { useId, useState, type ReactNode } from "react";

/**
 * An explanation attached to a term, without leaving the screen.
 *
 * Deliberately not the `title` attribute: that never appears on touch, cannot be
 * reached from the keyboard, and is invisible to a screen reader in practice.
 * Here the trigger is a real button with `aria-describedby`, so the text is
 * announced, tabbable, and works on a phone.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="tip">
      <button
        type="button"
        className="tip-trigger"
        aria-label={`הסבר: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span aria-hidden>?</span>
      </button>
      {open && (
        <span className="tip-bubble" id={id} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * The financial terms this app uses that a user has no reason to already know.
 *
 * Wording comes from the rules the app actually applies (CLAUDE.md §5), so the
 * explanation and the behaviour can never drift apart: if the rule changes, this
 * is the one place the sentence changes too.
 */
export const FINANCE_TERMS: Record<string, string> = {
  קרן: "החלק מהתשלום שמקטין את החוב עצמו. הוא לא הוצאה — הכסף עבר מהחשבון אל החוב שלך.",
  ריבית: "המחיר של ההלוואה. זו כן הוצאה, אבל הוצאה מימונית — היא נספרת בנפרד מהוצאות היום־יום.",
  "לוח סילוקין": "הטבלה שהבנק מפיק ובה כל התשלומים העתידיים: כמה קרן, כמה ריבית, ומה תהיה היתרה אחרי כל תשלום.",
  "פירעון מוקדם": "סגירת ההלוואה לפני הזמן. חוסכת את כל הריבית שנותרה, אבל הבנק בדרך כלל גובה עמלה.",
  "אשראי מתגלגל": "מימון פנימי של חברת האשראי — סכומים שנכנסים ויוצאים ומתקזזים. מוחרג מסכומי ההוצאות כדי לא לנפח אותם.",
  "הוצאה מימונית": "מה שעולה לך הכסף עצמו: ריביות ועמלות. מופרד מהוצאות רגילות כדי שיהיה ברור כמה עולה האשראי.",
  "מועד חיוב": "היום שבו חברת האשראי גובה בפועל. עסקה מיוחסת לחודש לפי המועד הזה, לא לפי יום הקנייה.",
  תרחיש: "מספר שחושב מהנחה ולא נלקח מדוח — לכן הוא מוצג בסוגריים ולא כעובדה.",
};

/** A term with its explanation attached. */
export function Term({ name }: { name: keyof typeof FINANCE_TERMS | string }) {
  const explanation = FINANCE_TERMS[name];
  if (!explanation) return <>{name}</>;
  return (
    <>
      {name}
      <Tooltip label={String(name)}>{explanation}</Tooltip>
    </>
  );
}
