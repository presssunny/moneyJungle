import { useState, type FormEvent } from "react";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/ErrorMessage";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";
import { apiErrorMessage } from "../../services/api";
import { closeLoan } from "../../services/finance.service";
import type { Loan, LoanEvent } from "../../types/models";
import { formatCurrency } from "../../utils/format";

const REASONS = [
  { value: "early_repayment", label: "פירעון מוקדם" },
  { value: "scheduled", label: "סיום מתוכנן" },
  { value: "refinanced", label: "מיחזור" },
];

/**
 * Closing a loan by hand — for a payoff the statement never carried, or one the
 * app could not attribute to a specific loan.
 *
 * Most closures never reach this dialog: importing the statement closes the loan
 * on its own. This is the fallback, and it produces exactly the same end state.
 */
export function CloseLoanDialog({
  loan,
  onCancel,
  onClosed,
}: {
  loan: Loan;
  onCancel: () => void;
  onClosed: (event: LoanEvent) => void;
}) {
  const [closedAt, setClosedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("early_repayment");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await closeLoan(loan.id, {
        closedAt,
        reason,
        closureCost: cost === "" ? null : Number(cost),
      });
      onClosed(result.event);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`סגירת ${loan.loanName}`} open onClose={onCancel}>
      <form onSubmit={submit}>
        {error && <ErrorMessage message={error} />}
        <p className="settings-hint">
          ההלוואה תעבור לרשימת ההלוואות שנסגרו. היא לא תימחק — היא ההיסטוריה של מה שכבר נפרע, ושל{" "}
          <strong>{formatCurrency(loan.monthlyPayment)}</strong> שיתפנו לך בכל חודש.
        </p>
        <div className="form-row">
          <Input
            label="תאריך הסגירה"
            type="date"
            required
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
          />
          <Select
            label="סיבה"
            options={REASONS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Input
          label="עמלות סגירה (₪) — אופציונלי"
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            ביטול
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "סוגר..." : "סגירת ההלוואה"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
