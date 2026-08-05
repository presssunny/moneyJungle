import { AsyncSection } from "../common/AsyncSection";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { SkeletonRows } from "../common/Skeleton";
import { UncertaintyBadge } from "../common/UncertaintyBadge";
import { useAsync } from "../../hooks/useAsync";
import { getEarlyRepaymentQuote } from "../../services/finance.service";
import type { Loan } from "../../types/models";
import { formatCurrency } from "../../utils/format";

/**
 * "What would it cost to close this today, and what would I gain?" Read-only.
 * The saving comes from the bank's own schedule; without one we say we cannot
 * tell rather than show a confident 0 (IA §1.2).
 */
export function EarlyRepaymentDialog({
  loan,
  onClose,
  onConfirmClose,
}: {
  loan: Loan;
  onClose: () => void;
  onConfirmClose: (loan: Loan) => void;
}) {
  const quote = useAsync(
    () => getEarlyRepaymentQuote(loan.id),
    [loan.id],
    "לא הצלחנו לחשב את הפירעון המוקדם"
  );

  return (
    <Modal title={`פירעון מוקדם — ${loan.loanName}`} open onClose={onClose}>
      <AsyncSection
        resource={quote}
        errorTitle="לא הצלחנו לחשב את הפירעון המוקדם"
        skeleton={<SkeletonRows rows={4} label="מחשב" />}
      >
        {(data) => (
          <>
            <div className="quote-grid">
              <div className="quote-row">
                <span>יתרת קרן</span>
                <strong className="mono">{formatCurrency(data.currentBalance)}</strong>
              </div>
              <div className="quote-row">
                <span>עמלת פירעון מוקדם</span>
                <strong className="mono">
                  {data.estimatedFee > 0 ? formatCurrency(data.estimatedFee) : "לא הוגדרה"}
                </strong>
              </div>
              <div className="quote-row quote-row-total">
                <span>לתשלום היום</span>
                <strong className="mono">{formatCurrency(data.payoffToday)}</strong>
              </div>
            </div>

            {data.hasSchedule ? (
              <div className="quote-gain">
                <div className="quote-row">
                  <span>ריבית עתידית שתיחסך</span>
                  <strong className="mono text-success">{formatCurrency(data.savedInterest)}</strong>
                </div>
                <div className="quote-row">
                  <span>חיסכון נטו (בניכוי העמלה)</span>
                  <strong className={`mono ${data.netSaving > 0 ? "text-success" : "text-danger"}`}>
                    {formatCurrency(data.netSaving)}
                  </strong>
                </div>
                <p className="text-muted">
                  ועוד {formatCurrency(loan.monthlyPayment)} שיתפנו בכל חודש, על פני{" "}
                  {data.remainingPayments} התשלומים שנותרו.
                </p>
              </div>
            ) : (
              <div className="quote-gain state-unknown">
                <p>
                  בלי לוח סילוקין מהבנק אי אפשר לדעת כמה ריבית תיחסך.{" "}
                  <UncertaintyBadge level="unknown" />
                </p>
                <p className="text-muted">
                  אפשר להעלות את לוח הסילוקין מתפריט הפעולות, ואז המספר יגיע מהבנק עצמו.
                </p>
              </div>
            )}

            <div className="modal-actions">
              <Button variant="ghost" onClick={onClose}>
                סגירה
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  onConfirmClose(loan);
                }}
              >
                כבר פרעתי — לסגור את ההלוואה
              </Button>
            </div>
          </>
        )}
      </AsyncSection>
    </Modal>
  );
}
