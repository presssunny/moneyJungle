import { useEffect, useRef, useState } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { Loading } from "../components/common/Loading";
import { ConnectDialog } from "../components/connections/ConnectDialog";
import { isActive, isWaiting, phaseLabel } from "../components/connections/syncPhases";
import { useAsync } from "../hooks/useAsync";
import { useConfirm } from "../hooks/useConfirm";
import { isAxiosError } from "axios";
import { apiErrorMessage } from "../services/api";
import { deleteConnection, getConnection, listConnections, syncConnection, updateConnection } from "../services/connections.service";
import type { ConnectionKind, ConnectionProviderInfo, FinancialConnection } from "../types/models";

// Faster while she is acting in the bank's window or on her phone, so the page follows her.
const POLL_MS = 3000;
const POLL_WAITING_MS = 1000;
const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

function StatusLine({ connection, onOpen, announce }: { connection: FinancialConnection; onOpen: () => void; announce: boolean }) {
  const sync = connection.syncs[0];
  if (!sync) return <p className="text-muted">עוד לא בוצע רענון.</p>;
  const text = sync.status === "running" ? phaseLabel(sync.phase)
    : sync.status === "succeeded" ? `${sync.message ?? "הרענון הסתיים"} · ${when(sync.finishedAt ?? sync.startedAt)}`
    : sync.status === "cancelled" ? "הרענון האחרון בוטל"
    : "הרענון האחרון נכשל";
  return (
    <div className={`connection-status-line ${sync.status === "failed" ? "connection-state-failed" : ""}`}>
      <span role={announce && sync.status === "running" ? "status" : undefined}>{sync.status === "running" && <span aria-hidden="true">◉ </span>}{text}</span>
      <Button size="sm" variant="ghost" onClick={onOpen} aria-label={`${sync.status === "running" ? "פתיחת הרענון" : "פרטי הרענון"}: ${connection.label}`}>{sync.status === "running" ? "פתיחה" : "פרטים"}</Button>
    </div>
  );
}

function ConnectionItem({ connection, provider, error, announce, onSwitchToWindow, onOpen, onRefresh, onRemove }: {
  connection: FinancialConnection; provider: ConnectionProviderInfo | undefined; error: string | null; announce: boolean;
  onSwitchToWindow: () => void; onOpen: () => void; onRefresh: () => void; onRemove: () => void;
}) {
  const active = isActive(connection);
  const method = provider?.loginMethods.find((m) => m.id === connection.loginMethod);
  // Made before 2026-10-20 with stored credentials: still syncs, and can move to the bank's own window.
  const legacy = connection.loginMethod === "password";
  const canSwitch = legacy && !!provider?.loginMethods.some((m) => m.id === "official_window");
  return (
    <li className="connection-item">
      <div className="connection-head">
        <div>
          <strong>{connection.label}</strong> <span className="text-muted">{provider?.name}</span>
          {method && <p className="text-muted">{method.label}{method.status === "experimental" && <span className="connection-tag">ניסיוני</span>}</p>}
          {legacy && <p className="text-muted">כניסה עם פרטים שנשמרו בעבר{canSwitch ? " — אפשר לעבור לכניסה בחלון הבנק" : ""}</p>}
          <p className="text-muted">{connection.verifiedAt ? `הכניסה אומתה ב־${when(connection.verifiedAt)}` : "הכניסה עוד לא אומתה — החיבור ייחשב פעיל רק אחרי רענון מוצלח"}</p>
        </div>
        <div className="row-actions">
          <Button size="sm" disabled={active || !!connection.retryBlockedReason} onClick={onRefresh} aria-label={`רענון נתונים: ${connection.label}`}>{active ? "מרענן…" : connection.loginMethod === "official_window" ? "פתיחת חלון הבנק" : "רענון נתונים"}</Button>
          {canSwitch && <Button size="sm" variant="ghost" disabled={active} onClick={onSwitchToWindow} aria-label={`מעבר לכניסה בחלון הבנק: ${connection.label}`}>מעבר לחלון הבנק</Button>}
          <Button size="sm" variant="ghost" disabled={active} onClick={onRemove} aria-label={`מחיקה: ${connection.label}`}>מחיקה</Button>
        </div>
      </div>
      <StatusLine connection={connection} onOpen={onOpen} announce={announce} />
      {!active && connection.retryMessage && <p className="text-muted">{connection.retryMessage}</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
    </li>
  );
}

/**
 * Bank and card logins are separate rows synced separately, so a Beinleumi
 * login waiting on her never holds up Cal, Max or Isracard.
 */
export default function ConnectionsPage() {
  const confirm = useConfirm();
  const resource = useAsync(listConnections, [], "לא הצלחנו לטעון את החיבורים", ["connections"]);
  const { data, setData } = resource;
  const [dialog, setDialog] = useState<{ open: boolean; connectionId: number | null; error: string }>({ open: false, connectionId: null, error: "" });
  const [cardError, setCardError] = useState<{ id: number; message: string } | null>(null);

  const connections = data?.connections ?? [];
  const activeIds = connections.filter(isActive).map((c) => c.id).join(",");
  const waiting = connections.some((c) => isActive(c) && c.syncs[0] && isWaiting(c.syncs[0]));

  const upsert = (next: FinancialConnection) => setData((old) => old && ({ ...old, connections: old.connections.some((c) => c.id === next.id) ? old.connections.map((c) => (c.id === next.id ? next : c)) : [...old.connections, next] }));
  const drop = (id: number) => setData((old) => old && ({ ...old, connections: old.connections.filter((c) => c.id !== id) }));

  // Polls are not awaited, so a slow reply could land after a newer one; only the latest request per connection counts.
  const latestPoll = useRef(new Map<number, number>());
  function poll(id: number) {
    const ticket = (latestPoll.current.get(id) ?? 0) + 1;
    latestPoll.current.set(id, ticket);
    getConnection(id, { quiet: true })
      .then((next) => { if (latestPoll.current.get(id) === ticket) upsert(next); })
      .catch((e: unknown) => { if (isAxiosError(e) && e.response?.status === 404) drop(id); /* otherwise the next tick retries */ });
  }

  useEffect(() => {
    if (!activeIds) return;
    const timer = window.setInterval(() => {
      for (const id of activeIds.split(",").map(Number)) poll(id);
    }, waiting ? POLL_WAITING_MS : POLL_MS);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds, waiting]);

  // A cooldown ends on the server's clock; fetch once it has, so the refresh button comes back on its own.
  const cooldowns = connections.filter((c) => c.retryBlockedReason === "cooldown" && c.retryAvailableAt).map((c) => `${c.id}@${c.retryAvailableAt}`).join(",");
  useEffect(() => {
    const timers = cooldowns.split(",").filter(Boolean).map((entry) => {
      const [id, at] = entry.split("@");
      return window.setTimeout(() => poll(Number(id)), Math.max(0, new Date(at).getTime() - Date.now()) + 500);
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldowns]);

  async function refresh(connection: FinancialConnection) {
    setCardError(null);
    try {
      upsert(await syncConnection(connection.id));
      setDialog({ open: true, connectionId: connection.id, error: "" });
    } catch (e) {
      setCardError({ id: connection.id, message: apiErrorMessage(e) });
    }
  }

  async function switchToWindow(connection: FinancialConnection) {
    setCardError(null);
    try { upsert(await updateConnection(connection.id, { loginMethod: "official_window" })); } catch (e) { setCardError({ id: connection.id, message: apiErrorMessage(e) }); }
  }

  function remove(connection: FinancialConnection) {
    confirm.ask({ title: "מחיקת חיבור", message: `החיבור "${connection.label}" ופרטי הכניסה השמורים שלו יימחקו. תנועות שכבר נוספו נשארות.`, tone: "danger", confirmLabel: "מחיקה" }, async () => {
      await deleteConnection(connection.id);
      setData((old) => old && ({ ...old, connections: old.connections.filter((c) => c.id !== connection.id) }));
    });
  }

  const section = (kind: ConnectionKind, title: string, loaded: { providers: ConnectionProviderInfo[]; connections: FinancialConnection[] }) => {
    const items = loaded.connections.filter((c) => c.kind === kind);
    return (
      <Card title={title}>
        {items.length ? <ul className="connection-list">{items.map((c) => (
          <ConnectionItem key={c.id} connection={c} provider={loaded.providers.find((p) => p.id === c.provider)}
            error={cardError?.id === c.id ? cardError.message : null} announce={!dialog.open}
            onSwitchToWindow={() => switchToWindow(c)}
            onOpen={() => setDialog({ open: true, connectionId: c.id, error: "" })} onRefresh={() => refresh(c)} onRemove={() => remove(c)} />
        ))}</ul> : <p className="text-muted">{kind === "card" ? (loaded.providers.find((p) => p.kind === "card" && !p.loginMethods.length)?.unavailableReason ?? "אין עדיין חיבור.") : "אין עדיין חיבור. אפשר להמשיך להעלות קבצים כרגיל."}</p>}
        {kind === "bank" && items.length > 0 && <p className="text-muted">ברענון הראשון כדאי להשוות את התנועות לדף החשבון של אותה תקופה: האתר עשוי לנסח חיובי כרטיס והחזרי הלוואה אחרת מהקובץ, ואז הם עלולים להיספר פעמיים.</p>}
      </Card>
    );
  };

  const tracked = dialog.connectionId === null ? null : connections.find((c) => c.id === dialog.connectionId) ?? null;
  // The connection it followed is gone (deleted elsewhere): close rather than fall back to the setup wizard.
  useEffect(() => {
    if (dialog.open && dialog.connectionId !== null && data && !tracked) setDialog({ open: false, connectionId: null, error: "" });
  }, [dialog.open, dialog.connectionId, data, tracked]);

  return (
    <div className="connections-page">
      <Card title="חשבונות מחוברים" action={<Button onClick={() => setDialog({ open: true, connectionId: null, error: "" })}>חיבור בנק או כרטיס</Button>}>
        <ol className="connect-intro">
          <li><strong>בוחרים בנק</strong><span>ואת החשבון שאליו ייכנסו התנועות</span></li>
          <li><strong>נכנסים בחלון של הבנק</strong><span>האתר האמיתי, בחלון כרום נפרד — לא אצלנו</span></li>
          <li><strong>רואים כל שלב</strong><span>מתי נכנסת, מתי התנועות נקראו</span></li>
          <li><strong>מאשרים</strong><span>במסך הייבוא, עם בדיקת כפילויות. שום דבר לא נוסף לפני כן</span></li>
        </ol>
        <p className="text-muted">אין רענון אוטומטי ואין ניסיון חוזר לבד. פרטי הכניסה לא עוברים דרכנו.</p>
      </Card>
      <AsyncSection resource={resource} errorTitle="לא הצלחנו לטעון את החיבורים" skeleton={<Loading />}>
        {(loaded) => <>
          {section("bank", "בנקים", loaded)}
          {section("card", "כרטיסי אשראי", loaded)}
          <ConnectDialog open={dialog.open} providers={loaded.providers} connection={tracked} initialError={dialog.error}
            onClose={() => setDialog({ open: false, connectionId: null, error: "" })}
            onCreated={(c, error) => { upsert(c); setDialog({ open: true, connectionId: c.id, error: error ?? "" }); }}
            onChanged={upsert}
            onSwitchToWindow={(c) => switchToWindow(c)} />
        </>}
      </AsyncSection>
      {confirm.dialog}
    </div>
  );
}
