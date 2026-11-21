import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";
import { Wizard, type WizardStep } from "../common/Wizard";
import { useAsync } from "../../hooks/useAsync";
import { useConfirm } from "../../hooks/useConfirm";
import { apiErrorMessage } from "../../services/api";
import { cancelSync, createConnection, syncConnection } from "../../services/connections.service";
import { createBankAccount, listBankAccounts } from "../../services/planning.service";
import type { BankAccount, ConnectionProviderInfo, FinancialConnection } from "../../types/models";
import { SyncJourney } from "./SyncJourney";
import { SyncSummary } from "./SyncSummary";
import { awaitsReview, isAccountItem, milestones, phaseLabel, REVIEWABLE, siteDomain, syncedLabel } from "./syncPhases";


function ProviderTiles({ providers, chosen, onChoose }: { providers: ConnectionProviderInfo[]; chosen: string; onChoose: (id: string) => void }) {
  const group = (kind: "bank" | "card", legend: string) => (
    <fieldset className="provider-group">
      <legend>{legend}</legend>
      <div className="provider-tiles">
        {providers.filter((p) => p.kind === kind).map((p) => {
          const method = p.loginMethods[0];
          const available = !!method;
          const note = !method ? "עוד לא זמין בחלון נפרד" : method.id === "official_window" ? `כניסה בחלון של הבנק${method.status === "experimental" ? " · ניסיוני" : ""}` : method.label;
          return (
            <label key={p.id} className={`provider-tile ${available ? "" : "provider-tile-off"}`}>
              <input type="radio" name="provider" value={p.id} checked={chosen === p.id} disabled={!available} onChange={() => onChoose(p.id)} />
              <span className="provider-tile-icon" aria-hidden="true">{kind === "bank" ? "🏦" : "💳"}</span>
              <span className="provider-tile-name">{p.name}</span>
              <span className="provider-tile-note">{note}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  const unavailable = providers.find((p) => !p.loginMethods.length);
  return (
    <>
      {group("bank", "בנק")}
      {group("card", "חברת אשראי")}
      {unavailable?.unavailableReason && <p className="text-muted">{unavailable.unavailableReason} <Link to="/imports">להעלאת קובץ</Link></p>}
    </>
  );
}

/**
 * The rows land in an account of ours, so one must exist. After a data wipe there is none — she makes
 * it right here; the server still checks it is hers when the connection is created.
 */
function AccountPicker({ bankName, value, onChange }: { bankName: string; value: string; onChange: (id: string) => void }) {
  const accounts = useAsync(listBankAccounts, [], "לא הצלחנו לטעון את חשבונות הבנק", ["bank"]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("עו״ש");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = accounts.data ?? [];

  async function add() {
    setBusy(true);
    setError("");
    try {
      const account = await createBankAccount({ bankName, accountName: name.trim() });
      accounts.setData((current: BankAccount[] | null) => [...(current ?? []).filter((a) => a.id !== account.id), account]);
      onChange(String(account.id));
      setAdding(false);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (accounts.loading && !accounts.data) return <p className="text-muted" role="status">טוענים את חשבונות הבנק…</p>;
  if (accounts.error && !accounts.data) {
    return <div className="error-message" role="alert">{accounts.error} <Button type="button" variant="outline" size="sm" onClick={() => void accounts.reload()}>נסי שוב</Button></div>;
  }
  const empty = !list.length;
  return (
    <div className="sync-account">
      {!empty && <Select label="התנועות ייכנסו לחשבון" required value={value} onChange={(e) => onChange(e.target.value)} placeholder="בחירת חשבון"
        options={list.map((a) => ({ value: a.id, label: `${a.bankName} — ${a.accountName}` }))} />}
      {empty && (
        <div className="sync-account-empty">
          <p><strong>עוד אין במערכת חשבון בנק שהתנועות ייכנסו אליו.</strong></p>
          <p className="text-muted">אפשר ליצור אותו כאן, בלי לצאת מהחלון. הוא נפתח ריק, ושום תנועה לא נכנסת אליו לפני שתאשרי את הייבוא.</p>
        </div>
      )}
      {(empty || adding) ? (
        <div className="sync-account-new">
          <Input label={`שם החשבון (${bankName})`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) { e.preventDefault(); void add(); } }} />
          <div className="sync-account-actions">
            <Button type="button" size="sm" onClick={() => void add()} disabled={!name.trim() || busy}>{busy ? "יוצרים…" : "יצירת החשבון"}</Button>
            {!empty && <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={busy}>ביטול</Button>}
          </div>
          {error && <div className="field-error" role="alert">{error}</div>}
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>+ חשבון חדש</Button>
      )}
    </div>
  );
}

function Setup({ providers, onCreated, onCancel }: { providers: ConnectionProviderInfo[]; onCreated: (c: FinancialConnection, syncError?: string) => void; onCancel: () => void }) {
  const [providerId, setProviderId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [accountHint, setAccountHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((p) => p.id === providerId);
  const method = provider?.loginMethods[0];
  const domain = siteDomain(provider?.officialLoginUrl ?? null);

  async function finish() {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createConnection({ provider: provider.id, ...(provider.kind === "bank" ? { bankAccountId: Number(bankAccountId), accountHint } : {}) });
      // The connection exists either way; a refused first sync (e.g. too many attempts) is shown on it.
      try { onCreated(await syncConnection(created.id)); } catch (e) { onCreated(created, apiErrorMessage(e)); }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const steps: WizardStep[] = [
    { key: "provider", title: "מאיפה לקרוא תנועות?", hint: "ההתחברות תיעשה בחלון של הבנק עצמו. אצלנו לא מקלידים פרטי כניסה.", body: <ProviderTiles providers={providers} chosen={providerId} onChoose={setProviderId} />, isValid: !!provider && !!method },
    {
      key: "prepare", title: "לפני שפותחים את חלון הבנק",
      isValid: provider?.kind !== "bank" || !!bankAccountId,
      body: provider && (
        <div className="connection-form">
          <div className="sync-journey-guide">
            <p><strong>ייפתח חלון כרום נפרד עם האתר האמיתי של {provider.name}.</strong>{method?.status === "experimental" && <span className="connection-tag">ניסיוני — טרם נבדק מול הבנק</span>}</p>
            <ul className="sync-journey-guide-list">
              {domain && <li>בשורת הכתובת של החלון תופיע כתובת שמסתיימת ב־<bdi dir="ltr" className="sync-journey-host">{domain}</bdi> — כך יודעים שזה האתר של הבנק. אם מופיעה כתובת אחרת, אל תיכנסי וסגרי את החלון.</li>}
              <li>את נכנסת שם בעצמך, בדרך שהבנק מציע. פרטי הכניסה לא עוברים דרכנו ולא נשמרים.</li>
              <li>כאן תראי כל שלב: מתי נכנסת, מתי התנועות נקראו, ומה מחכה לאישור שלך.</li>
            </ul>
          </div>
          {provider.kind === "bank" && <AccountPicker bankName={provider.name} value={bankAccountId} onChange={setBankAccountId} />}
          {provider.kind === "bank" && <Input label="ספרות אחרונות של מספר החשבון (רק אם יש כמה חשבונות באותה כניסה)" value={accountHint} onChange={(e) => setAccountHint(e.target.value)} inputMode="numeric" />}
          <p className="text-muted">אין רענון אוטומטי ואין ניסיון חוזר לבד. התנועות לא נוספות מיד — הן מגיעות למסך אישור הייבוא.</p>
        </div>
      ),
    },
  ];

  return <Wizard steps={steps} onFinish={finish} onCancel={onCancel} finishLabel="פתיחת חלון הבנק" busy={busy} error={error} />;
}

function Track({ connection, provider, initialError, onChanged, onClose, onSwitchToWindow }: {
  connection: FinancialConnection; provider: ConnectionProviderInfo | undefined; initialError: string;
  onChanged: (c: FinancialConnection) => void; onClose: () => void; onSwitchToWindow: () => void;
}) {
  const confirm = useConfirm();
  const [error, setError] = useState(initialError);
  const sync = connection.syncs[0];
  const bankName = provider?.name ?? connection.label;
  const m = sync ? milestones(sync) : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // One live region that only changes its text: a region inserted already filled is often not read.
  const announcement = !sync ? "" : sync.status === "running" ? phaseLabel(sync.phase)
    : sync.status === "succeeded" ? (awaitsReview(sync) ? `${syncedLabel(sync)}. התנועות מחכות לאישור שלך.` : m?.approved ? "הייבוא אושר." : `${syncedLabel(sync)}. אין תנועות חדשות לבדיקה.`)
    : sync.status === "cancelled" ? "הרענון בוטל. לא נוסף דבר." : "";
  // The buttons that had focus vanish when the state changes; focus moves to the new state, not to <body>.
  useEffect(() => { headingRef.current?.focus(); }, [sync?.status]);

  async function act(action: () => Promise<FinancialConnection>) {
    setError("");
    try { onChanged(await action()); } catch (e) { setError(apiErrorMessage(e)); }
  }
  function askCancel() {
    confirm.ask({ title: "לעצור את הרענון?", message: "חלון הבנק ייסגר, ותנועות שנקראו עד עכשיו לא יישמרו.", tone: "danger", confirmLabel: "עצירה" }, () => act(() => cancelSync(connection.id)));
  }

  const title = !sync ? "עוד לא בוצע רענון" : sync.status === "running" ? (m?.signedIn ? "התחברת — קוראים את הנתונים" : "מתחברים לבנק")
    : sync.status === "succeeded" ? (m?.approved ? (sync.incomplete ? "התנועות נקלטו — חלק מהנתונים לא נאספו" : "הכול נקלט") : awaitsReview(sync) ? "הנתונים מוכנים לבדיקה" : "הרענון הסתיים") : sync.status === "cancelled" ? "הרענון בוטל" : "הרענון נעצר";
  const reviewLink = sync?.outcome?.find((item) => item.importSessionId && REVIEWABLE.includes(item.review?.status ?? ""))?.importSessionId;
  // A schedule's payments and a site snapshot's figures are not account transactions.
  const added = (sync?.outcome ?? []).filter(isAccountItem).reduce((sum, item) => sum + (item.review?.counts.included ?? 0), 0);
  const canSwitch = connection.loginMethod === "password" && !!provider?.loginMethods.some((x) => x.id === "official_window");

  return (
    <div className="sync-track">
      <h3 className="sync-state-title" ref={headingRef} tabIndex={-1}>{title}</h3>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {/* One place for each success, one at a time: approved (final), her turn to review, or nothing new. */}
      {sync?.status === "succeeded" && m?.approved && (
        <div className="sync-journey-success sync-journey-success-final">
          <span className="sync-journey-success-mark" aria-hidden="true">✓</span>
          <div><strong>הייבוא אושר — התנועות נוספו</strong><p>{added === 1 ? "נוספה תנועה אחת." : `נוספו ${added} תנועות.`}</p>
            {sync.incomplete && <p className="connection-state connection-state-waiting">חלק מהנתונים לא נאספו — הפירוט בסיכום הרענון.</p>}</div>
        </div>
      )}
      {sync?.status === "succeeded" && !m?.approved && awaitsReview(sync) && (
        <div className="sync-journey-turn">
          <span className="sync-journey-turn-mark" aria-hidden="true">✓</span>
          <div>
            <strong>{syncedLabel(sync)}. עכשיו תורך: לבדוק ולאשר</strong>
            <p>שום דבר לא נוסף עדיין. התנועות מחכות לאישור שלך במסך הייבוא.</p>
            {reviewLink && <Link className="btn btn-primary btn-md" to={`/imports?session=${reviewLink}`}>לבדיקה ואישור</Link>}
          </div>
        </div>
      )}
      {sync && <SyncJourney sync={sync} provider={provider} bankName={bankName} />}
      {sync?.status === "succeeded" && <SyncSummary sync={sync} />}
      {sync?.status === "failed" && <div role="alert" className="connection-state connection-state-failed"><strong>הרענון נעצר</strong><p>{sync.message}</p></div>}
      {sync?.status === "cancelled" && <p>{sync.message ?? "הרענון בוטל. לא נוסף דבר."}</p>}
      {sync && sync.status !== "running" && connection.retryBlockedReason && <p className="text-muted">{connection.retryMessage}</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="sync-actions">
        {sync?.status === "running" ? <>
          <Button variant="outline" onClick={askCancel}>עצירת הרענון</Button>
          <Button onClick={onClose}>סגירה, הרענון ימשיך</Button>
        </> : <>
          <Button variant="ghost" onClick={onClose}>סגירה</Button>
          {canSwitch && <Button variant="outline" onClick={onSwitchToWindow}>מעבר לכניסה בחלון הבנק</Button>}
          {(!sync || sync.status !== "succeeded") && !connection.retryBlockedReason && <Button onClick={() => act(() => syncConnection(connection.id))}>{sync ? "ניסיון נוסף" : "פתיחת חלון הבנק"}</Button>}
        </>}
      </div>
      {confirm.dialog}
    </div>
  );
}

/**
 * Our own window around a bank login. It shows only what the server reports; the bank's page, its QR
 * and its cookies never come here, and nothing here looks like the bank's login (CLAUDE.md §7).
 */
export function ConnectDialog({ open, providers, connection, initialError = "", onClose, onCreated, onChanged, onSwitchToWindow }: {
  open: boolean;
  providers: ConnectionProviderInfo[];
  /** Live from the page's polling; null while a new connection is being set up. */
  connection: FinancialConnection | null;
  /** Why the sync the page just asked for was refused, if it was. */
  initialError?: string;
  onClose: () => void;
  onCreated: (c: FinancialConnection, syncError?: string) => void;
  onChanged: (c: FinancialConnection) => void;
  onSwitchToWindow: (c: FinancialConnection) => void;
}) {
  const provider = connection ? providers.find((p) => p.id === connection.provider) : undefined;
  const title = connection ? `חיבור: ${connection.label}` : "חיבור בנק או כרטיס";
  return (
    <Modal title={title} open={open} onClose={onClose}>
      {connection
        ? <Track key={connection.id} connection={connection} provider={provider} initialError={initialError} onChanged={onChanged} onClose={onClose} onSwitchToWindow={() => onSwitchToWindow(connection)} />
        : <Setup providers={providers} onCreated={onCreated} onCancel={onClose} />}
    </Modal>
  );
}
