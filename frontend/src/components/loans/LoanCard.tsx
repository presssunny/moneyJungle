import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../common/Button";
import { Term } from "../common/Tooltip";
import { LoanProgressBar } from "./LoanProgressBar";
import { LoanStatusBadge } from "./LoanStatusBadge";
import type { Loan } from "../../types/models";
import { formatCurrency } from "../../utils/format";

const LOAN_TYPE_LABELS: Record<string, string> = {
  bank: "בנק",
  credit: "אשראי",
  car: "רכב",
  mortgage: "משכנתא",
  private: "פרטית",
  other: "אחר",
};

export interface LoanActions {
  onSchedule: (loan: Loan) => void;
  onEdit: (loan: Loan) => void;
  onClose: (loan: Loan) => void;
  onEarlyRepayment: (loan: Loan) => void;
  onUploadSchedule: (loan: Loan) => void;
  onDelete: (loan: Loan) => void;
}

function ActionsMenu({ loan, actions }: { loan: Loan; actions: LoanActions }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closed = loan.status === "finished";

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Array<{ label: string; icon: string; run: () => void; danger?: boolean }> = [
    { label: "לוח סילוקין", icon: "📋", run: () => actions.onSchedule(loan) },
    { label: "העלאת לוח מהבנק", icon: "📥", run: () => actions.onUploadSchedule(loan) },
    { label: "עריכה", icon: "✏️", run: () => actions.onEdit(loan) },
  ];
  if (!closed) {
    items.push(
      { label: "פירעון מוקדם", icon: "⚡", run: () => actions.onEarlyRepayment(loan) },
      { label: "סגירת הלוואה", icon: "🔒", run: () => actions.onClose(loan) },
      { label: "מחיקה", icon: "🗑️", run: () => actions.onDelete(loan), danger: true }
    );
  }

  return (
    <div className="loan-menu" ref={wrapRef}>
      <button
        className="loan-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`פעולות עבור ${loan.loanName}`}
      >
        ⋯
      </button>
      {open && (
        <div className="loan-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`loan-menu-item ${item.danger ? "loan-menu-item-danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <span aria-hidden>{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One fact in the card's detail row. */
function Fact({ label, value, tone }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <div className="loan-fact">
      <span className="loan-fact-label">{label}</span>
      <span className={`loan-fact-value mono ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

/**
 * One loan as a card, not a table row, with a fixed hierarchy: what it is →
 * where it stands → what it costs → what can be done about it.
 */
export function LoanCard({ loan, actions }: { loan: Loan; actions: LoanActions }) {
  const closed = loan.status === "finished";
  const { progress } = loan;

  return (
    <article className={`loan-card ${closed ? "loan-card-closed" : ""}`}>
      <header className="loan-card-head">
        <div className="loan-card-identity">
          <LoanStatusBadge lifecycle={progress.lifecycle} closedAt={loan.closedAt} />
          <h3 className="loan-card-name">
            {loan.computed.isExpensive && !closed && <span title="ריבית גבוהה">🔥 </span>}
            {loan.loanName}
          </h3>
          <p className="loan-card-meta">
            {loan.loanNumber && <span>הלוואה {loan.loanNumber}</span>}
            {loan.trackNumber && <span>מסלול {loan.trackNumber}</span>}
            <span>{LOAN_TYPE_LABELS[loan.loanType] ?? loan.loanType}</span>
            {loan.lenderName && <span>{loan.lenderName}</span>}
            {loan.scheduleSource === "bank_file" && (
              <span className="loan-card-source" title="הנתונים נקראו מלוח הסילוקין של הבנק">
                🏦 מלוח הבנק
              </span>
            )}
          </p>
        </div>
        <ActionsMenu loan={loan} actions={actions} />
      </header>

      <LoanProgressBar loan={loan} />

      {closed ? (
        <div className="loan-card-facts">
          <Fact label="סכום מקורי" value={formatCurrency(loan.originalAmount)} />
          <Fact
            label="החזר חודשי שהתפנה"
            value={formatCurrency(loan.monthlyPayment)}
            tone="text-success"
          />
          {loan.closureCost !== null && (
            <Fact label="עמלות סגירה" value={formatCurrency(loan.closureCost)} tone="text-muted" />
          )}
          <Fact
            label="סיבת הסגירה"
            value={loan.closureReason === "early_repayment" ? "פירעון מוקדם" : "סיום מתוכנן"}
          />
        </div>
      ) : (
        <div className="loan-card-facts">
          <Fact label={<>יתרת <Term name="קרן" /></>} value={formatCurrency(loan.currentBalance)} />
          <Fact label="החזר חודשי" value={formatCurrency(loan.monthlyPayment)} />
          <Fact
            label="ריבית שנתית"
            value={`${loan.annualInterestRate}%`}
            tone={loan.computed.isExpensive ? "text-danger" : ""}
          />
          <Fact
            label={<><Term name="ריבית" /> חודשית</>}
            value={formatCurrency(loan.computed.monthlyInterestPayment)}
            tone="text-warning"
          />
          <Fact
            label="תשלומים"
            value={
              progress.paymentsMade !== null && progress.totalPayments !== null
                ? `${progress.paymentsMade} מתוך ${progress.totalPayments}`
                : "—"
            }
          />
          <Fact
            label="נותרו"
            value={progress.paymentsRemaining !== null ? `${progress.paymentsRemaining} תשלומים` : "—"}
          />
          <Fact label="תאריך פתיחה" value={new Date(loan.startDate).toLocaleDateString("he-IL")} />
          <Fact
            label="סיום צפוי"
            value={loan.endDate ? new Date(loan.endDate).toLocaleDateString("he-IL") : "—"}
          />
        </div>
      )}

      {!closed && (
        <footer className="loan-card-foot">
          <Button size="sm" variant="outline" onClick={() => actions.onSchedule(loan)}>
            📋 לוח סילוקין
          </Button>
          <Button size="sm" variant="ghost" onClick={() => actions.onEarlyRepayment(loan)}>
            ⚡ פירעון מוקדם
          </Button>
        </footer>
      )}
    </article>
  );
}
