import type { LoanDetailsPreviewItem, SiteSnapshotPreview, SnapshotLoanField, SnapshotLoanValue, StandingOrderPreviewItem } from "../../types/models";
import { formatCurrency, formatDate } from "../../utils/format";

const NOT_SHOWN = "לא הופיע בדף";
const exact = (n: number) => formatCurrency(n, { exact: true });

const FILL_LABEL: Record<SnapshotLoanField, string> = {
  currentBalance: "יתרת קרן", annualInterestRate: "ריבית שנתית", endDate: "תאריך סיום", totalPayments: "מספר תשלומים",
  paymentsMade: "תשלומים ששולמו", trackNumber: "מספר מסלול", isIndexLinked: "הצמדה למדד",
};

function fillValue(field: SnapshotLoanField, value: SnapshotLoanValue): string {
  if (typeof value === "boolean") return value ? "צמודה למדד" : "לא צמודה";
  if (field === "currentBalance" && typeof value === "number") return exact(value);
  if (field === "annualInterestRate") return `${value}%`;
  if (field === "endDate") return formatDate(String(value));
  return String(value);
}

const INTEREST_TYPE: Record<NonNullable<LoanDetailsPreviewItem["interestType"]>, string> = { fixed: "קבועה", prime: "פריים", variable: "משתנה" };

function loanMatchText({ match }: LoanDetailsPreviewItem): string {
  if (match.reason === "matched") return `תואם להלוואה ${match.loanName ?? ""} · ${match.checkingLines} חיובים בעו״ש`;
  if (match.reason === "no_loan") return "לא נמצאה הלוואה מתאימה במערכת — אפשר להעלות לוח סילוקין או לאשר את ההלוואה שזוהתה מהעו״ש";
  return "לא ברור לאיזו הלוואה זה שייך — לא נקשר אוטומטית";
}

/** A row is shown when the page had a value, or when the server says the page left it out. */
function loanRows(loan: LoanDetailsPreviewItem): Array<{ label: string; value: string | null; estimate?: boolean }> {
  const missing = new Set(loan.missing);
  // Linked or floating: the next payment the bank shows moves with the index or the prime rate.
  const moving = loan.indexLinked === true || loan.interestType === "prime" || loan.interestType === "variable";
  const rows: Array<{ field: string; label: string; value: string | null; estimate?: boolean }> = [
    { field: "principalBalance", label: "יתרת קרן", value: loan.principalBalance === null ? null : exact(loan.principalBalance) },
    { field: "indexedBalance", label: "יתרה משוערכת (כולל הצמדה)", value: loan.indexedBalance === null ? null : exact(loan.indexedBalance) },
    { field: "annualInterestRate", label: "ריבית שנתית", value: loan.annualInterestRate === null ? null : `${loan.annualInterestRate}%` },
    { field: "interestType", label: "סוג ריבית", value: loan.interestType ? INTEREST_TYPE[loan.interestType] : null },
    { field: "indexLinked", label: "הצמדה למדד", value: loan.indexLinked === null ? null : loan.indexLinked ? "צמודה למדד" : "לא צמודה" },
    { field: "nextPaymentAmount", label: "ההחזר הבא", value: loan.nextPaymentAmount === null ? null : exact(loan.nextPaymentAmount), estimate: moving },
    { field: "nextPaymentDate", label: "מועד ההחזר הבא", value: loan.nextPaymentDate ? formatDate(loan.nextPaymentDate) : null },
    { field: "paymentsMade", label: "תשלומים ששולמו", value: loan.paymentsMade === null ? null : String(loan.paymentsMade) },
    { field: "paymentsTotal", label: "מספר תשלומים", value: loan.paymentsTotal === null ? null : String(loan.paymentsTotal) },
    { field: "endDate", label: "תאריך סיום", value: loan.endDate ? formatDate(loan.endDate) : null },
  ];
  return rows.filter((r) => r.value !== null || missing.has(r.field));
}

function LoanItem({ loan, approved }: { loan: LoanDetailsPreviewItem; approved: boolean }) {
  const title = `הלוואה …${loan.loanNumberLast4}${loan.trackNumber ? ` · מסלול ${loan.trackNumber}` : ""}`;
  return (
    <li className="site-snapshot-item">
      <h3 className="site-snapshot-title">{title}{loan.name && <span className="text-muted"> · {loan.name}</span>}</h3>
      <p className="site-snapshot-source">לפי אתר הבנק, נכון ל־{formatDate(loan.asOf)}</p>
      <dl className="site-snapshot-facts" aria-label={`הנתונים באתר הבנק: ${title}`}>
        {loanRows(loan).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value === null ? <span className="text-muted">{NOT_SHOWN}</span> : <><span dir="ltr">{row.value}</span>{row.estimate && <span className="source-tag" title="הסכום משתנה עם המדד או הריבית">אומדן</span>}</>}</dd>
          </div>
        ))}
      </dl>
      <p className={loan.match.reason === "matched" ? "site-snapshot-match" : "site-snapshot-match connection-state-waiting"}>{loanMatchText(loan)}</p>
      {!approved && (
        <div className="site-snapshot-fills">
          <strong>מה יישמר באישור:</strong>
          {loan.fills.length
            ? <ul>{loan.fills.map((f) => <li key={f.field}>{FILL_LABEL[f.field]}: <span dir="ltr">{fillValue(f.field, f.value)}</span></li>)}</ul>
            : <span> לא יישמר דבר — הנתונים מוצגים להשוואה</span>}
        </div>
      )}
      {loan.notes.length > 0 && (
        <div className="site-snapshot-notes">
          <strong>לתשומת לבך (לא יישמר):</strong>
          <ul>{loan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </li>
  );
}

const ORDER_KIND: Record<NonNullable<StandingOrderPreviewItem["kind"]>, string> = { standing_order: "הוראת קבע", direct_debit: "הרשאה לחיוב" };
const ORDER_STATUS: Record<NonNullable<StandingOrderPreviewItem["status"]>, string> = { active: "פעילה", inactive: "לא פעילה" };

function orderMatchText({ match }: StandingOrderPreviewItem): string {
  if (match.reason === "matched") {
    const base = `תואם לחיוב חוזר ${match.name ?? ""}${match.lastDebitDate ? ` · חיוב אחרון ${formatDate(match.lastDebitDate)}` : ""}`;
    if (match.recurringPaymentId !== null) return `${base} — יסומן 'אומת באתר הבנק'`;
    return match.canAdd ? `${base} — עוד לא שמור כתשלום קבוע` : `${base} — לא יישמר`;
  }
  if (match.reason === "no_checking_debit") return "הוראה פעילה בבנק שעוד לא ראינו חיוב שלה — לא תישמר";
  return "לא ברור לאיזה חיוב זה שייך — לא נקשר אוטומטית";
}

interface OrderProps { order: StandingOrderPreviewItem; checked: boolean; onToggle: (key: string) => void; disabled: boolean; approved: boolean }

function OrderItem({ order, checked, onToggle, disabled, approved }: OrderProps) {
  const facts = [
    order.amount === null ? "סכום משתנה" : exact(order.amount),
    order.dayOfMonth === null ? `יום החיוב ${NOT_SHOWN}` : `ב־${order.dayOfMonth} לחודש`,
    order.kind ? ORDER_KIND[order.kind] : null,
    order.status ? ORDER_STATUS[order.status] : null,
  ].filter((x): x is string => x !== null);
  return (
    <li className="site-snapshot-item">
      <h3 className="site-snapshot-title">{order.payee}</h3>
      <p>{facts.join(" · ")}</p>
      <p className={order.match.reason === "matched" ? "site-snapshot-match" : "site-snapshot-match connection-state-waiting"}>{orderMatchText(order)}</p>
      {order.match.canAdd && !approved && (
        <label className="household-consent">
          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(order.key)} />
          {" "}להוסיף כתשלום קבוע{order.match.name ? ` (${order.match.name})` : ""}
        </label>
      )}
    </li>
  );
}

interface Props {
  snapshot: SiteSnapshotPreview;
  accepted: Set<string>;
  onToggle: (key: string) => void;
  disabled: boolean;
  /** After approval the server re-matched the view, so "what will be saved" no longer applies. */
  approved: boolean;
}

export function SiteSnapshotReview({ snapshot, accepted, onToggle, disabled, approved }: Props) {
  if (snapshot.kind === "loan_details") {
    if (!snapshot.loans.length) return <p className="text-muted">לא נקראו מסלולי הלוואה מהדף.</p>;
    return <ul className="site-snapshot-list" aria-label="מסלולי הלוואה מאתר הבנק">{snapshot.loans.map((loan) => <LoanItem key={loan.key} loan={loan} approved={approved} />)}</ul>;
  }
  if (!snapshot.orders.length) return <p className="text-muted">לא נקראו הוראות קבע מהדף.</p>;
  return (
    <ul className="site-snapshot-list" aria-label="הוראות קבע והרשאות מאתר הבנק">
      {snapshot.orders.map((order) => <OrderItem key={order.key} order={order} checked={accepted.has(order.key)} onToggle={onToggle} disabled={disabled} approved={approved} />)}
    </ul>
  );
}
