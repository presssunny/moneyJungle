import { Button } from "./Button";

interface WidgetErrorProps {
  /** What failed, in the user's words ("לא הצלחנו לטעון את המגמה"). */
  title: string;
  /** Technical/served detail, shown small underneath. */
  detail?: string | null;
  onRetry?: () => void;
  /** Thin single-line variant, for a widget that already shows stale data. */
  inline?: boolean;
}

/**
 * Widget-level failure state (IA §1.3). Every failed fetch must land here:
 * a visible message plus a retry — never a silently empty widget.
 */
export function WidgetError({ title, detail, onRetry, inline = false }: WidgetErrorProps) {
  return (
    <div className={`widget-error ${inline ? "widget-error-inline" : ""}`} role="alert">
      <span className="widget-error-icon" aria-hidden>
        ⚠️
      </span>
      <div className="widget-error-body">
        <div className="widget-error-title">{title}</div>
        {detail && detail !== title && <div className="widget-error-detail">{detail}</div>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          נסי שוב
        </Button>
      )}
    </div>
  );
}
