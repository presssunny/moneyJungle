import { useState } from "react";
import { useTransactionFilters } from "../../hooks/useTransactionFilters";
import { formatDate } from "../../utils/format";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Input } from "./Input";
import { Select, type SelectOption } from "./Select";

/** URL-backed filters: the active selection remains visible when details close. */
export function TransactionFilters({ options, kind = "expenses" }: { options: SelectOption[]; kind?: "expenses" | "incomes" }) {
  const { params, set, clear } = useTransactionFilters();
  const key = kind === "expenses" ? "category" : "type";
  const [advancedOpen, setAdvancedOpen] = useState(() => ["from", "to", "uncat", "recurring"].some(k => params.has(k)));
  const labels: Record<string, string> = {
    q: `חיפוש: ${params.get("q") ?? ""}`,
    [key]: String(options.find(o => String(o.value) === params.get(key))?.label ?? "סוג"),
    from: params.get("from") ? `מ־${formatDate(params.get("from")!)}` : "",
    to: params.get("to") ? `עד ${formatDate(params.get("to")!)}` : "",
    uncat: "לא מסווגות", recurring: "תשלומים קבועים",
  };
  const active = Object.keys(labels).filter(k => params.get(k));
  return <div className="transaction-filters">
    <div className="transaction-filter-main">
      <Input placeholder="חיפוש בתנועות…" aria-label="חיפוש חופשי" value={params.get("q") ?? ""} onChange={e => set("q", e.target.value)}/>
      <Select options={options} placeholder={kind === "expenses" ? "כל הקטגוריות" : "כל הסוגים"} aria-label={kind === "expenses" ? "סינון לפי קטגוריה" : "סינון לפי סוג הכנסה"} value={params.get(key) ?? ""} onChange={e => set(key, e.target.value)}/>
      <Button variant="outline" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}><Icon name="filter" size={18}/>עוד מסננים</Button>
    </div>
    {advancedOpen && <div className="transaction-filter-advanced">
      <Input label="מתאריך" aria-label="מתאריך" type="date" value={params.get("from") ?? ""} onChange={e => set("from",e.target.value)}/>
      <Input label="עד תאריך" aria-label="עד תאריך" type="date" value={params.get("to") ?? ""} onChange={e => set("to",e.target.value)}/>
      {kind === "expenses" && <>
        <label className="filter-toggle"><input type="checkbox" checked={params.get("uncat") === "1"} onChange={e => set("uncat",e.target.checked ? "1" : "")}/>רק לא מסווגות</label>
        <label className="filter-toggle"><input type="checkbox" checked={params.get("recurring") === "1"} onChange={e => set("recurring",e.target.checked ? "1" : "")}/>רק תשלומים קבועים</label>
      </>}
    </div>}
    {active.length > 0 && <div className="applied-filters" aria-label="מסננים פעילים">
      {active.map(k => <button key={k} className="filter-chip" onClick={() => set(k, "")} aria-label={`הסרת מסנן ${labels[k]}`}>{labels[k]}<span aria-hidden="true">×</span></button>)}
      <Button size="sm" variant="ghost" onClick={clear}>{kind === "expenses" ? "ניקוי מסננים ✕" : "ניקוי הסינון"}</Button>
    </div>}
  </div>;
}
