import { useState } from "react";
import { useAsync } from "../../hooks/useAsync";
import { apiErrorMessage } from "../../services/api";
import { getFunding, saveFunding } from "../../services/journey.service";
import type { FundingInput, FundingOverview } from "../../types/journey.types";
import { formatCurrency } from "../../utils/format";
import { AsyncSection } from "../common/AsyncSection";
import { Button } from "../common/Button";
import { Card } from "../common/Card";
import { Select } from "../common/Select";
import { SkeletonRows } from "../common/Skeleton";

const KIND_LABELS: Record<string, string> = { credit: "כרטיס אשראי", loan: "הלוואה", recurring: "תשלום קבוע", subscription: "מנוי", reminder: "הוצאה צפויה" };

/**
 * With several bank accounts the daily estimate is planned from one of them, and
 * every obligation needs the account that pays it. A suggestion from statements is
 * shown, never applied: only what the household confirms here counts.
 */
export function FundingPlan() {
  const resource = useAsync(getFunding, [], "לא הצלחנו לטעון את שיוך החשבונות", ["bank", "journey", "credit", "loans", "recurring", "subscriptions", "reminders"]);
  const [draft, setDraft] = useState<FundingInput>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(input: FundingInput) {
    setBusy(true); setMessage("");
    try {
      resource.setData(await saveFunding(input));
      setDraft({});
      setMessage("נשמר. יש לאשר מחדש שהמידע עדכני כדי לחשב את האומדן היומי.");
    } catch (e) { setMessage(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }

  const assigned = (data: FundingOverview, sourceKey: string) =>
    draft.assignments?.find((a) => a.sourceKey === sourceKey)?.bankAccountId ?? data.sources.find((s) => s.sourceKey === sourceKey)?.assignedAccountId ?? null;
  const setAssigned = (sourceKey: string, bankAccountId: number | null) =>
    setDraft((d) => ({ ...d, assignments: [...(d.assignments ?? []).filter((a) => a.sourceKey !== sourceKey), { sourceKey, bankAccountId }] }));

  return (
    <AsyncSection resource={resource} errorTitle="לא הצלחנו לטעון את שיוך החשבונות" skeleton={<SkeletonRows rows={3} />} isEmpty={(data) => data.accounts.length < 2} emptyState={<></>}>
      {(data) => {
        const options = data.accounts.map((a) => ({ value: String(a.id), label: a.name }));
        const spending = draft.spendingAccountId !== undefined ? draft.spendingAccountId : data.spendingAccountId;
        const location = draft.savedReserveLocation !== undefined ? draft.savedReserveLocation : data.savedReserveLocation;
        const dirty = Object.keys(draft).length > 0;
        return (
          <Card title="תכנון יומי כשיש כמה חשבונות">
            <div id="funding" className="funding-plan">
              <p className="text-muted">האומדן היומי מחושב מחשבון אחד בלבד. כסף בחשבון אחר אינו נחשב זמין; אם בחשבון אחר חסר כסף לחיובים שלו, ההעברה הנדרשת תנוכה מהחשבון שבחרת.</p>
              <Select label="החשבון שממנו יוצאות ההוצאות השוטפות" placeholder="בחירת חשבון" options={options}
                value={spending ? String(spending) : ""} onChange={(e) => setDraft((d) => ({ ...d, spendingAccountId: e.target.value ? Number(e.target.value) : null }))} />
              {data.savedReserve > 0 && (
                <fieldset className="funding-reserve">
                  <legend>איפה מוחזק החיסכון ששוריין ({formatCurrency(data.savedReserve)})?</legend>
                  <label className="filter-toggle"><input type="radio" name="reserve" checked={location === "spending"} onChange={() => setDraft((d) => ({ ...d, savedReserveLocation: "spending" }))} />בחשבון ההוצאות השוטפות — לנכות מהאומדן</label>
                  <label className="filter-toggle"><input type="radio" name="reserve" checked={location === "elsewhere"} onChange={() => setDraft((d) => ({ ...d, savedReserveLocation: "elsewhere" }))} />בחשבון אחר — כבר מחוץ לחישוב</label>
                </fieldset>
              )}
              {data.sources.length > 0 && (
                <ul className="funding-sources" aria-label="חשבון משלם לכל התחייבות">
                  {data.sources.map((source) => {
                    const current = assigned(data, source.sourceKey);
                    const suggestion = source.suggestedAccountId && current !== source.suggestedAccountId ? data.accounts.find((a) => a.id === source.suggestedAccountId) : undefined;
                    return (
                      <li key={source.sourceKey} className="funding-source">
                        <div><strong>{source.name}</strong> <span className="text-muted">· {KIND_LABELS[source.kind] ?? source.kind}</span></div>
                        <Select aria-label={`החשבון שמשלם את ${source.name}`} placeholder="לא נקבע" options={options}
                          value={current ? String(current) : ""} onChange={(e) => setAssigned(source.sourceKey, e.target.value ? Number(e.target.value) : null)} />
                        {suggestion && (
                          <p className="text-muted funding-suggestion">
                            הצעה: {suggestion.name} — {source.suggestionReason}{" "}
                            <Button size="sm" variant="outline" onClick={() => setAssigned(source.sourceKey, suggestion.id)}>אישור ההצעה</Button>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="row-actions">
                <Button disabled={!dirty || busy} onClick={() => void save(draft)}>{busy ? "שומר…" : "שמירת השיוך"}</Button>
              </div>
              {message && <p role="status">{message}</p>}
            </div>
          </Card>
        );
      }}
    </AsyncSection>
  );
}
