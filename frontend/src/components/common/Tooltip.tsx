import { useId, useState, type ReactNode } from "react";
import { FINANCE_TERMS } from "./financeTerms";

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
