import { useEffect, useRef } from "react";
import { AsyncSection } from "../common/AsyncSection";
import { Button } from "../common/Button";
import { SkeletonRows } from "../common/Skeleton";
import { UncertaintyBadge } from "../common/UncertaintyBadge";
import { useAsync } from "../../hooks/useAsync";
import { getLoanSchedule } from "../../services/finance.service";
import type { Loan } from "../../types/models";
import { exportLoanSchedule, LOAN_EXPORT_FORMATS } from "../../utils/loanExport";
import { formatCurrency } from "../../utils/format";

/**
 * The full amortisation table in a drawer — 30-60 rows would bury what the main
 * list is for. The header states provenance: a bank file and a Spitzer
 * simulation look identical as tables, so the difference must be said (IA §1.2).
 */
export function LoanScheduleDrawer({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const schedule = useAsync(
    () => getLoanSchedule(loan.id),
    [loan.id],
    "לא הצלחנו לטעון את לוח הסילוקין"
  );
  const nextRowRef = useRef<HTMLTableRowElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the panel so the keyboard lands somewhere useful.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  // Open on the payment that is actually next, not on payment #1 from years ago.
  useEffect(() => {
    if (schedule.data) nextRowRef.current?.scrollIntoView({ block: "center" });
  }, [schedule.data]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`לוח סילוקין — ${loan.loanName}`}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2 className="drawer-title">לוח סילוקין</h2>
            <p className="drawer-sub">
              {loan.loanName}
              {loan.loanNumber && <span className="text-muted"> · הלוואה {loan.loanNumber}</span>}
              {loan.trackNumber && <span className="text-muted"> · מסלול {loan.trackNumber}</span>}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </header>

        <AsyncSection
          resource={schedule}
          errorTitle="לא הצלחנו לטעון את לוח הסילוקין"
          skeleton={<SkeletonRows rows={8} label="טוען לוח סילוקין" />}
        >
          {(data) => (
            <>
              <div className={`drawer-source ${data.source === "computed" ? "state-scenario" : ""}`}>
                {data.source === "bank_file" ? (
                  <>
                    <span aria-hidden>🏦</span> הלוח כפי שהבנק הפיק אותו — {data.rows.length} תשלומים
                  </>
                ) : (
                  <>
                    <span aria-hidden>≈</span> אין לוח מהבנק להלוואה הזו, אז זהו חישוב שפיצר לפי
                    היתרה והריבית <UncertaintyBadge level="scenario" />
                  </>
                )}
              </div>

              <div className="drawer-body">
                <table className="table drawer-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>תאריך</th>
                      <th>קרן</th>
                      <th>ריבית</th>
                      <th>תשלום</th>
                      <th>יתרה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr
                        key={row.paymentNumber}
                        ref={row.status === "next" ? nextRowRef : undefined}
                        className={`schedule-row schedule-row-${row.status}`}
                      >
                        <td data-label="#">
                          {row.paymentNumber}
                          {row.status === "next" && <span className="schedule-next">הבא</span>}
                          {row.status === "paid" && (
                            <span className="schedule-paid" aria-label="שולם">
                              ✓
                            </span>
                          )}
                        </td>
                        <td data-label="תאריך">{new Date(row.date).toLocaleDateString("he-IL")}</td>
                        <td data-label="קרן" className="mono">{formatCurrency(row.principal)}</td>
                        <td data-label="ריבית" className="mono text-warning">{formatCurrency(row.interest)}</td>
                        <td data-label="תשלום" className="mono">{formatCurrency(row.total)}</td>
                        <td data-label="יתרה" className="mono">{formatCurrency(row.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="drawer-foot">
                <div className="drawer-totals">
                  קרן <strong className="mono">{formatCurrency(data.totals.principal)}</strong> · ריבית{" "}
                  <strong className="mono text-warning">{formatCurrency(data.totals.interest)}</strong>
                </div>
                <div className="drawer-actions">
                  {LOAN_EXPORT_FORMATS.map((format) => (
                    <Button
                      key={format.id}
                      size="sm"
                      variant="outline"
                      onClick={() => exportLoanSchedule(format.id, loan, data)}
                    >
                      <span aria-hidden>{format.icon}</span> {format.label}
                    </Button>
                  ))}
                </div>
              </footer>
            </>
          )}
        </AsyncSection>
      </aside>
    </div>
  );
}
