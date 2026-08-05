import { UncertaintyBadge } from "../common/UncertaintyBadge";
import { formatCurrency } from "../../utils/format";
import type { Loan } from "../../types/models";

/**
 * How much of the loan is behind the user. The percentage is only as certain as
 * the opening amount: when that was reconstructed from a mid-way schedule the bar
 * is muted and marked `תרחיש` rather than presented as fact (IA §1.2).
 */
export function LoanProgressBar({ loan }: { loan: Loan }) {
  const { progressPercent, principalRepaid, certainty, lifecycle } = loan.progress;
  const scenario = certainty === "scenario";

  return (
    <div className="loan-progress">
      <div className="loan-progress-head">
        <span className="loan-progress-label">
          נפרעו <strong className="mono">{formatCurrency(principalRepaid)}</strong>
          <span className="text-muted"> מתוך {formatCurrency(loan.originalAmount)}</span>
        </span>
        <span className="loan-progress-pct">
          <span className="mono">{scenario ? `(${progressPercent}%)` : `${progressPercent}%`}</span>
          {scenario && <UncertaintyBadge level="scenario" />}
        </span>
      </div>
      <div
        className={`loan-progress-track ${scenario ? "state-scenario" : ""}`}
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          scenario
            ? `התקדמות בפירעון: ${progressPercent} אחוז, תרחיש — הסכום המקורי משוחזר`
            : `התקדמות בפירעון: ${progressPercent} אחוז`
        }
      >
        <div
          className={`loan-progress-fill loan-progress-fill-${lifecycle}`}
          style={{ width: `${Math.max(progressPercent, 1.5)}%` }}
        />
      </div>
    </div>
  );
}
