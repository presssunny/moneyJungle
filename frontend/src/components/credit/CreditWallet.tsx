import { MetricExplanation } from "../common/MetricExplanation";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AsyncSection } from "../common/AsyncSection";
import { Button } from "../common/Button";
import { Card } from "../common/Card";
import { Input } from "../common/Input";
import { Select } from "../common/Select";
import { SkeletonCard } from "../common/Skeleton";
import { Table } from "../common/Table";
import { SummaryCard } from "../dashboard/SummaryCard";
import { useAsync } from "../../hooks/useAsync";
import { getWallet, createCreditCard, updateCreditCard, assignCreditCard, assignTransactionCard } from "../../services/future.service";
import { apiErrorMessage } from "../../services/api";
import type { CreditCardInput, CreditImport } from "../../types/models";
import { formatCurrency, formatDate, formatMonthKey } from "../../utils/format";
import "../../styles/future.css";

const blank: CreditCardInput = { name: "", issuer: "", lastFour: "", billingDay: null };

export function CreditWallet({ monthKey, revision, imports, onChanged, onImport }: { monthKey: string; revision: number; imports: CreditImport[]; onChanged: () => void; onImport: () => void }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("card") ?? "all";
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState(blank);
  const [importId, setImportId] = useState("");
  const [assignment, setAssignment] = useState("");
  const [singleCard, setSingleCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const resource = useAsync(() => getWallet(monthKey), [monthKey, revision]);
  const selectCard = (value: string) => {
    setParams((old) => { const next = new URLSearchParams(old); next.set("card", value); return next; }, { replace: true });
    setSearch(""); setCategory("");
  };
  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); resource.reload(); onChanged(); setMessage(success); }
    catch (error) { setMessage(apiErrorMessage(error)); }
    finally { setBusy(false); }
  }

  return <div className="future-page">
    <div className="future-heading"><div><span className="text-muted">האשראי שלך, במקום אחד</span><h2>הארנק שלי</h2><p>בחירת כרטיס מציגה את ההוצאות שלו ב־{formatMonthKey(monthKey)}.</p></div><div className="row-actions"><Button onClick={onImport}>ייבוא דוח</Button><Button variant="outline" onClick={() => { setEditingId(null); setDraft(blank); setFormOpen(!formOpen); }} aria-expanded={formOpen}>+ הוספת כרטיס</Button></div></div>
    {message && <p className="info-banner" role="status">{message}</p>}
    {formOpen && <Card title={editingId === null ? "כרטיס חדש" : "עריכת כרטיס"}><form onSubmit={(e) => { e.preventDefault(); void mutate(async () => { const card = editingId === null ? await createCreditCard(draft) : await updateCreditCard(editingId, draft); setDraft(blank); setFormOpen(false); selectCard(String(card.id)); }, "פרטי הכרטיס נשמרו. אפשר לשייך אליו דוח או עסקאות."); }}>
      <div className="future-form">
        <Input label="שם הכרטיס" maxLength={80} required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="למשל: הכרטיס הביתי" />
        <Input label="חברת אשראי" maxLength={80} required value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
        <Input label="ארבע ספרות אחרונות" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={draft.lastFour} onChange={(e) => setDraft({ ...draft, lastFour: e.target.value })} />
        <Input label="יום חיוב בחודש (אופציונלי)" type="number" min={1} max={31} value={draft.billingDay ?? ""} onChange={(e) => setDraft({ ...draft, billingDay: e.target.value ? Number(e.target.value) : null })} />
      </div><Button type="submit" disabled={busy}>שמירת כרטיס</Button>
    </form></Card>}
    <AsyncSection resource={resource} errorTitle="לא הצלחנו לטעון את הארנק" skeleton={<SkeletonCard />}>
      {(data) => {
        const card = data.cards.find((item) => String(item.id) === selectedId);
        const effectiveId = selectedId === "unassigned" ? "unassigned" : card ? selectedId : "all";
        const summary = effectiveId === "unassigned" ? data.unassigned : card ?? data.all;
        const label = effectiveId === "unassigned" ? "עסקאות ללא כרטיס" : card?.name ?? "כל הכרטיסים";
        const options = [{ value: "", label: "ללא שיוך" }, ...data.cards.map((item) => ({ value: String(item.id), label: `${item.name} · ${item.lastFour}` }))];
        const rows = summary.transactions.filter((row) => (!category || row.categoryName === category) && row.businessName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
        return <>
          <div className="wallet-cards" aria-label="בחירת כרטיס">
            <button type="button" className="wallet-card wallet-card-overview" aria-pressed={effectiveId === "all"} onClick={() => selectCard("all")}><span>כל הכרטיסים</span><strong>{formatCurrency(data.all.total)}</strong><small>הוצאות מאושרות בחודש הנבחר</small></button>
            {data.cards.map((item) => <button type="button" key={item.id} className="wallet-card" aria-pressed={effectiveId === String(item.id)} onClick={() => selectCard(String(item.id))}>
              <span className="wallet-card-top"><span>{item.issuer}</span><span aria-hidden>▣</span></span><strong>{item.name}</strong><span className="wallet-number" dir="ltr">•••• •••• •••• {item.lastFour}</span>
              <span>{formatCurrency(item.total)} <small>בחודש הנבחר</small></span><small>{item.nextCharge ? `עסקאות לחיוב קרוב: ${formatCurrency(item.nextCharge.amount)} · ${formatDate(item.nextCharge.date)}` : "אין חיוב עתידי ידוע בדוחות"}</small>
            </button>)}
            <button type="button" className="wallet-card wallet-card-overview" aria-pressed={effectiveId === "unassigned"} onClick={() => selectCard("unassigned")}><span>ללא שיוך לכרטיס</span><strong>{formatCurrency(data.unassigned.total)}</strong><small>שיוך ידני דרך העסקאות או הדוח</small></button>
          </div>
          {!data.cards.length && <p className="info-banner">הוספת כרטיס ושיוך העסקאות יאפשרו לראות הוצאות לכל כרטיס. העסקאות הקיימות מופיעות בינתיים ללא שיוך.</p>}
          {card && <div className="row-actions"><Button size="sm" variant="ghost" onClick={() => { setEditingId(card.id); setDraft({ name: card.name, issuer: card.issuer, lastFour: card.lastFour, billingDay: card.billingDay }); setFormOpen(true); }}>עריכת פרטי הכרטיס</Button>{card.billingDay !== null && <span className="text-muted">יום חיוב שהוגדר: {card.billingDay}</span>}</div>}
          <p className="text-muted">הסכומים מבוססים על דוחות מאושרים בלבד; ייתכן שכיסוי התקופה חלקי. {data.pendingCount > 0 && `${data.pendingCount} עסקאות ממתינות לאישור ואינן נכללות.`} {data.lastConfirmedImportAt ? `מועד ייבוא הדוח המאושר האחרון לחשבון: ${formatDate(data.lastConfirmedImportAt)}.` : "אין עדיין דוח מאושר בחשבון."}</p>
          <div className="kpi-row">
            <SummaryCard label={`הוצאות · ${label}`} value={formatCurrency(summary.total)} sub={formatMonthKey(monthKey)} />
            <SummaryCard label="שינוי מול החודש הקודם" value={summary.delta === null ? "—" : `${summary.delta > 0 ? "+" : ""}${formatCurrency(summary.delta)}`} certainty={summary.delta === null ? "unknown" : "measured"} sub="לפי עסקאות רשומות · לא בהכרח חודשים מלאים" />
            <SummaryCard label="עסקאות בחיוב הקרוב" value={summary.nextCharge ? formatCurrency(summary.nextCharge.amount) : "—"} certainty={summary.nextCharge ? "measured" : "unknown"} sub={summary.nextCharge ? `${formatDate(summary.nextCharge.date)} · לפי הדוח, ללא מימון פנימי` : "אין מועד חיוב עתידי בדוחות המאושרים"} />
          </div>
          <MetricExplanation title="מה נכלל בחיוב הקרוב?" metric="creditCharge" card={effectiveId}/>
          <Card title={`עסקאות · ${label}`}>
            <div className="future-form"><Input label="חיפוש בית עסק" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /><Select label="קטגוריה" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "כל הקטגוריות" }, ...summary.categories.map((item) => ({ value: item.name, label: item.name }))]} /></div>
            <Table key={`${effectiveId}-${monthKey}-${search}-${category}`} rows={rows} pageSize={25} rowKey={(row) => row.id} emptyState={<p>אין עסקאות להצגה בבחירה הזו.</p>} columns={[
              { key: "date", header: "תאריך עסקה", render: (row) => formatDate(row.transactionDate) },
              { key: "business", header: "בית עסק", render: (row) => <span>{row.businessName}{row.paymentCount > 1 && <small className="text-muted"> · עסקה בתשלומים ({row.paymentCount})</small>}</span> },
              { key: "category", header: "קטגוריה", render: (row) => row.categoryName },
              { key: "charge", header: "ירידה מהבנק", render: (row) => row.chargeDate ? formatDate(row.chargeDate) : "לא ידוע" },
              { key: "amount", header: "סכום", render: (row) => formatCurrency(row.amount) },
              { key: "card", header: "שיוך לכרטיס", render: (row) => <Select aria-label={`כרטיס לעסקה ${row.businessName}`} disabled={busy} value={row.cardId ?? ""} options={options} onChange={(e) => { void mutate(() => assignTransactionCard(row.id, e.target.value ? Number(e.target.value) : null), "שיוך העסקה עודכן"); }} /> },
            ]} />
          </Card>
          <details className="card"><summary>סיכומים נוספים והסבר</summary><ul className="future-events">{summary.categories.map((item) => <li key={item.name}><span>{item.name}</span><strong>{formatCurrency(item.amount)}</strong></li>)}</ul>
            <p>מימון פנימי בחודש: {formatCurrency(summary.financingTotal)} — מוחרג מסכומי ההוצאה. זיכויים מקטינים את ההוצאה.</p>
            <p>חודש ההוצאה נקבע לפי תאריך הייחוס במערכת. חיוב קרוב מבוסס על מועד הירידה הרשום בדוח, ולא על יום החיוב שהוזן לכרטיס. בלי לוח תשלומים מלא לא מחושבת יתרת תשלומים עתידית.</p>
          </details>
          <details className="card"><summary>שיוך דוח שלם לכרטיס</summary><p>פעולה זו משייכת מחדש את כל העסקאות בדוח. לדוח שמכיל כמה כרטיסים, השתמשו בשיוך לכל עסקה בטבלה.</p>
            <form onSubmit={(e) => { e.preventDefault(); void mutate(() => assignCreditCard(Number(importId), assignment ? Number(assignment) : null), "עסקאות הדוח שויכו"); }}>
              <div className="future-form"><Select label="דוח לשיוך" value={importId} required placeholder="בחירת דוח" onChange={(e) => { setImportId(e.target.value); setSingleCard(false); }} options={imports.map((item) => ({ value: item.id, label: item.fileName }))} /><Select label="כרטיס לשיוך הדוח" value={assignment} onChange={(e) => setAssignment(e.target.value)} options={options} /></div>
              <label className="future-check"><input type="checkbox" checked={singleCard} onChange={(e) => setSingleCard(e.target.checked)} required />כל העסקאות בדוח שייכות לכרטיס שנבחר</label><Button type="submit" disabled={busy || !importId || !singleCard}>שיוך הדוח</Button>
            </form>
          </details>
        </>;
      }}
    </AsyncSection>
  </div>;
}
