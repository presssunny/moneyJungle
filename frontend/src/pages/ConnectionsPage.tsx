import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Select } from "../components/common/Select";
import { useAsync } from "../hooks/useAsync";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../services/api";
import { createConnection, deleteConnection, getConnection, listConnections, syncConnection, updateConnectionCredentials } from "../services/connections.service";
import { listBankAccounts } from "../services/planning.service";
import type { ConnectionKind, ConnectionProviderInfo, FinancialConnection } from "../types/models";

const POLL_MS = 3000;
const isActive = (c: FinancialConnection) => ["running", "awaiting_approval"].includes(c.syncs[0]?.status ?? "");
const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

function CredentialFields({ provider, values, onChange }: { provider: ConnectionProviderInfo; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return <>{provider.fields.map((f) => (
    <Input key={f.key} label={f.label} type={f.secret ? "password" : "text"} autoComplete={f.secret ? "new-password" : "off"} required
      value={values[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)} />
  ))}</>;
}

function SyncState({ connection, provider }: { connection: FinancialConnection; provider: ConnectionProviderInfo | undefined }) {
  const sync = connection.syncs[0];
  if (!sync) return <p className="text-muted">עוד לא בוצע רענון.</p>;
  if (sync.status === "awaiting_approval") return <div role="status" className="connection-state connection-state-waiting"><strong>ממתין לאישור באפליקציית הבנק</strong>{provider?.approvalHint && <p>{provider.approvalHint}</p>}</div>;
  if (sync.status === "running") return <p role="status" className="connection-state">מתחבר וקורא תנועות…</p>;
  if (sync.status === "failed") return <div role="alert" className="connection-state connection-state-failed"><strong>הרענון נכשל</strong><p>{sync.message}</p></div>;
  return (
    <div className="connection-state">
      <p>{sync.message} · {when(sync.finishedAt ?? sync.startedAt)}</p>
      <ul className="journey-list">{(sync.outcome ?? []).map((o) => (
        <li key={o.target}>
          {o.importSessionId ? <Link to={`/imports?session=${o.importSessionId}`}>{o.target}: {o.rows} תנועות לאישור</Link> : <span>{o.target}: {o.note ?? "לא נוסף דוח"}</span>}
          {(o.skippedPending > 0 || o.skippedForeign > 0) && <span className="text-muted">{[o.skippedPending && `${o.skippedPending} עדיין בקליטה — ייכנסו ברענון הבא`, o.skippedForeign && `${o.skippedForeign} חויבו במטבע זר ולא נכללו`].filter(Boolean).join(" · ")}</span>}
        </li>
      ))}</ul>
    </div>
  );
}

function ConnectionItem({ connection, provider, onChanged, onRemove }: { connection: FinancialConnection; provider: ConnectionProviderInfo | undefined; onChanged: (c: FinancialConnection) => void; onRemove: () => void }) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const active = isActive(connection);

  async function run(action: () => Promise<FinancialConnection>) {
    setError("");
    try { onChanged(await action()); } catch (e) { setError(apiErrorMessage(e)); }
  }
  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    await run(() => updateConnectionCredentials(connection.id, values));
    setEditing(false); setValues({});
  }

  return (
    <li className="connection-item">
      <div className="connection-head">
        <div>
          <strong>{connection.label}</strong> <span className="text-muted">{provider?.name}</span>
          <p className="text-muted">{connection.verifiedAt ? `הכניסה אומתה ב־${when(connection.verifiedAt)}` : "הכניסה עוד לא אומתה — החיבור ייחשב פעיל רק אחרי רענון מוצלח"}</p>
        </div>
        <div className="row-actions">
          <Button size="sm" disabled={active} onClick={() => run(() => syncConnection(connection.id))}>{active ? "מרענן…" : "רענון נתונים"}</Button>
          <Button size="sm" variant="ghost" disabled={active} onClick={() => setEditing((v) => !v)}>עדכון פרטי כניסה</Button>
          <Button size="sm" variant="ghost" disabled={active} onClick={onRemove}>מחיקה</Button>
        </div>
      </div>
      <SyncState connection={connection} provider={provider} />
      {editing && provider && <form className="connection-form" onSubmit={saveCredentials}>
        <CredentialFields provider={provider} values={values} onChange={(k, v) => setValues((old) => ({ ...old, [k]: v }))} />
        <Button type="submit" size="sm">שמירה</Button>
      </form>}
      {error && <p role="alert" className="field-error">{error}</p>}
    </li>
  );
}

function AddConnection({ kind, providers, onAdded }: { kind: ConnectionKind; providers: ConnectionProviderInfo[]; onAdded: (c: FinancialConnection) => void }) {
  const options = providers.filter((p) => p.kind === kind);
  const [providerId, setProviderId] = useState(options[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [bankAccountId, setBankAccountId] = useState("");
  const [accountHint, setAccountHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts = useAsync(() => (kind === "bank" ? listBankAccounts() : Promise.resolve([])), [kind], "לא הצלחנו לטעון את חשבונות הבנק", ["bank"]);
  const provider = options.find((p) => p.id === providerId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      onAdded(await createConnection({ provider: providerId, credentials: values, ...(kind === "bank" ? { bankAccountId: Number(bankAccountId), accountHint } : {}) }));
      setValues({}); setAccountHint("");
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <form className="connection-form" onSubmit={submit}>
      <Select label={kind === "bank" ? "בנק" : "חברת אשראי"} value={providerId} onChange={(e) => { setProviderId(e.target.value); setValues({}); }} options={options.map((p) => ({ value: p.id, label: p.name }))} />
      {kind === "bank" && <Select label="התנועות ייכנסו לחשבון" required value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} placeholder="בחירת חשבון"
        options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.bankName} — ${a.accountName}` }))} />}
      {provider && <CredentialFields provider={provider} values={values} onChange={(k, v) => setValues((old) => ({ ...old, [k]: v }))} />}
      {kind === "bank" && <Input label="ספרות אחרונות של מספר החשבון (רק אם יש כמה חשבונות באותה כניסה)" value={accountHint} onChange={(e) => setAccountHint(e.target.value)} inputMode="numeric" />}
      {kind === "card" && <p className="text-muted">העסקאות משויכות לכרטיס לפי 4 הספרות האחרונות. כרטיס שלא מוגדר במערכת יופיע כהערה אחרי הרענון.</p>}
      <Button type="submit" disabled={busy}>{busy ? "שומר…" : "הוספת חיבור"}</Button>
      {error && <p role="alert" className="field-error">{error}</p>}
    </form>
  );
}

function Section({ kind, title, data, onChanged, onRemove }: { kind: ConnectionKind; title: string; data: { providers: ConnectionProviderInfo[]; connections: FinancialConnection[] }; onChanged: (c: FinancialConnection) => void; onRemove: (c: FinancialConnection) => void }) {
  const [adding, setAdding] = useState(false);
  const items = data.connections.filter((c) => c.kind === kind);
  return (
    <Card title={title} action={<Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>{adding ? "סגירה" : "חיבור חדש"}</Button>}>
      {items.length ? <ul className="connection-list">{items.map((c) => (
        <ConnectionItem key={c.id} connection={c} provider={data.providers.find((p) => p.id === c.provider)} onChanged={onChanged} onRemove={() => onRemove(c)} />
      ))}</ul> : !adding && <p className="text-muted">אין עדיין חיבור. אפשר להמשיך להעלות קבצים כרגיל.</p>}
      {adding && <AddConnection kind={kind} providers={data.providers} onAdded={(c) => { onChanged(c); setAdding(false); }} />}
    </Card>
  );
}

/**
 * Bank and card logins are separate rows synced separately, so a Beinleumi
 * login stuck on phone approval never holds up Cal, Max or Isracard.
 */
export default function ConnectionsPage() {
  const confirm = useConfirm();
  const resource = useAsync(listConnections, [], "לא הצלחנו לטעון את החיבורים", ["connections"]);
  const { data, setData } = resource;
  const activeIds = (data?.connections ?? []).filter(isActive).map((c) => c.id).join(",");

  const upsert = (next: FinancialConnection) => setData((old) => old && ({ ...old, connections: old.connections.some((c) => c.id === next.id) ? old.connections.map((c) => (c.id === next.id ? next : c)) : [...old.connections, next] }));

  useEffect(() => {
    if (!activeIds) return;
    const timer = window.setInterval(() => {
      for (const id of activeIds.split(",").map(Number)) getConnection(id).then(upsert).catch(() => { /* next tick retries */ });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds]);

  function remove(connection: FinancialConnection) {
    confirm.ask({ title: "מחיקת חיבור", message: `החיבור "${connection.label}" ופרטי הכניסה השמורים שלו יימחקו. תנועות שכבר נוספו נשארות.`, tone: "danger", confirmLabel: "מחיקה" }, async () => {
      await deleteConnection(connection.id);
      setData((old) => old && ({ ...old, connections: old.connections.filter((c) => c.id !== connection.id) }));
    });
  }

  return (
    <div className="connections-page">
      <Card title="חשבונות מחוברים">
        <p>רענון נכנס לאתר הבנק או חברת האשראי מהמחשב הזה, עם פרטי הכניסה שלך, וקורא את התנועות. הן לא נוספות מיד: הן מגיעות למסך אישור הייבוא, עם אותה בדיקת כפילויות כמו בהעלאת קובץ.</p>
        <p className="text-muted">פרטי הכניסה נשמרים מוצפנים במחשב הזה בלבד. אין רענון אוטומטי ואין ניסיון חוזר לבד — אם הבנק מבקש אישור בטלפון, צריך לאשר אותו בזמן הרענון.</p>
      </Card>
      <AsyncSection resource={resource} errorTitle="לא הצלחנו לטעון את החיבורים" skeleton={<Loading />}>
        {(loaded) => <>
          <Section kind="bank" title="בנקים" data={loaded} onChanged={upsert} onRemove={remove} />
          <Section kind="card" title="כרטיסי אשראי" data={loaded} onChanged={upsert} onRemove={remove} />
        </>}
      </AsyncSection>
      {confirm.dialog}
    </div>
  );
}
