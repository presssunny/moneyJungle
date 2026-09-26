import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../common/Button";
import { Card } from "../common/Card";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";
import { useAsync } from "../../hooks/useAsync";
import { apiErrorMessage } from "../../services/api";
import { getDuplicate, getDuplicateHistory, reviewDuplicate, undoDuplicate } from "../../services/householdAssistant.service";
import type { DuplicateDecision, DuplicateRecord, DuplicateReviewInput, DuplicateReviewView, HouseholdSnapshot } from "../../types/models";
import { formatCurrency, formatDate, formatMonthKey } from "../../utils/format";

const sourceNames = { expense: "הוצאה ידנית", credit: "עסקה בכרטיס אשראי", income: "הכנסה" };
const decisions = { separate: "עסקאות נפרדות", remove_manual: "רישום ידני הוסר", source_charge: "דורש בירור מול המנפיק" };
const statuses = { active: "החלטה שמורה", stale: "המקור השתנה — יש לבדוק מחדש", undone: "ההחלטה בוטלה" };
const label = (r: DuplicateRecord) => `${sourceNames[r.kind]} ${r.key.split(":")[1]} · ${r.name} · ${formatCurrency(r.amount)}`;

function Records({ records, removedKey }: { records: DuplicateRecord[]; removedKey?: string | null }) {
  return <ul className="duplicate-records">{records.map(r => <li key={r.key}>
    <div><strong>{r.name}</strong><span className="text-muted">{sourceNames[r.kind]} · {formatDate(r.date)} · מזהה {r.key.split(":")[1]}{r.kind === "credit" ? ` · כרטיס ${r.scope}` : ""}</span>{r.key === removedKey && <span>הרישום שהוסר</span>}</div>
    <bdi>{formatCurrency(r.amount)}</bdi>{r.key !== removedKey && <Link to={r.to} target="_blank" rel="noopener noreferrer" aria-label={`פתיחת ${sourceNames[r.kind]} ${r.key.split(":")[1]} בחלון חדש`}>למקור ↗</Link>}
  </li>)}</ul>;
}

function ReviewDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const evidence = useAsync(() => getDuplicate(id), [id]);
  const [decision, setDecision] = useState<DuplicateDecision | "">("");
  const [removedKey, setRemovedKey] = useState("");
  const [keptKey, setKeptKey] = useState("");
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const setConfirmed = (value: boolean) => setConfirmedVersion(value ? evidence.data?.version ?? null : null);
  const confirmed = Boolean(evidence.data && evidence.data.version === confirmedVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; input: DuplicateReviewInput } | null>(null);
  const candidate = evidence.data;
  const removed = candidate?.records.find(r => r.key === removedKey);
  const ready = candidate && decision && !evidence.loading && !evidence.error && confirmed && !busy && (decision !== "remove_manual" || removed && removedKey !== keptKey && candidate.records.some(r => r.key === keptKey));
  async function save() {
    if (!ready || !candidate || !decision) return;
    const payload = { candidateId: candidate.id, version: candidate.version, decision, confirmed: true as const, ...(decision === "remove_manual" ? { removedKey, keptKey } : {}) };
    const key = JSON.stringify(payload);
    if (request.current?.key !== key) request.current = { key, input: { ...payload, requestId: crypto.randomUUID() } };
    setBusy(true); setError("");
    try { await reviewDuplicate(request.current.input); onSaved(); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Modal open title="בדיקת רישומים דומים" size="wide" onClose={() => { if (!busy) onClose(); }} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>חזרה</Button><Button variant={decision === "remove_manual" ? "danger" : "primary"} disabled={!ready} onClick={() => void save()}>{busy ? "שומר החלטה…" : decision === "remove_manual" ? "אישור והסרת הרישום שנבחר" : "שמירת ההחלטה"}</Button></>}>
    <div className="duplicate-review" aria-busy={busy || evidence.loading}>
      {evidence.loading && <p role="status">בודקים שוב…</p>}
      {(evidence.error || error) && <div role="alert"><p>{evidence.error || error}</p><Button variant="outline" disabled={busy || evidence.loading} onClick={() => { setConfirmed(false); setError(""); void evidence.reload(); }}>בדיקה מחדש</Button></div>}
      {candidate && <><p>השוו את כל {candidate.recordCount} הרשומות למקור. שם וסכום זהים אינם הוכחה לכפילות.</p><Records records={candidate.records} />
        <fieldset disabled={busy || evidence.loading || Boolean(evidence.error)} className="duplicate-options"><legend>מה מצאתם?</legend>
          {(["separate", ...(candidate.records.some(r => r.kind !== "credit") ? ["remove_manual"] : ["source_charge"])] as DuplicateDecision[]).map(value => <label key={value}><input type="radio" name="duplicate-decision" value={value} checked={decision === value} onChange={() => { setDecision(value); setConfirmed(false); setError(""); }} /><span>{value === "separate" ? "אלה עסקאות נפרדות" : value === "remove_manual" ? "רישום ידני נוסף בטעות" : "החיובים מופיעים בדוח ודורשים בירור"}</span></label>)}
          {decision === "remove_manual" && <div className="duplicate-selection"><Select label="איזה רישום להסיר?" placeholder="בחירת רישום ידני" value={removedKey} options={candidate.records.filter(r => r.kind !== "credit").map(r => ({ value: r.key, label: label(r) }))} onChange={e => { setRemovedKey(e.target.value); setKeptKey(""); setConfirmed(false); }} /><Select label="איזה רישום נשאר?" placeholder="בחירת הרישום הנכון" value={keptKey} options={candidate.records.filter(r => r.key !== removedKey).map(r => ({ value: r.key, label: label(r) }))} onChange={e => { setKeptKey(e.target.value); setConfirmed(false); }} /></div>}
          {decision && <div className="duplicate-impact" role="status">{decision === "remove_manual" ? removed ? <><strong>יוסר רישום אחד של {formatCurrency(removed.amount)}.</strong><p>{removed.kind === "income" ? "ההכנסות" : "ההוצאות"} לחודש {formatMonthKey(removed.date.slice(0, 7))} יקטנו בסכום הזה. שאר הרשומות נשארות. אפשר לשחזר מההיסטוריה כל עוד המקורות לא השתנו.</p></> : "בחרו איזה רישום להסיר ואיזה להשאיר." : decision === "source_charge" ? "כל החיובים נשארים בסכומים. ההחלטה תופיע במעקב לבירור מול המנפיק; לא נשלחת אליו פנייה אוטומטית." : "כל הרישומים והסכומים נשארים. הקבוצה לא תופיע לבדיקה חוזרת כל עוד המקורות לא השתנו."}</div>}
          {decision && <label className="household-consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />בדקתי את המקור ואני מאשר/ת את השינוי המתואר</label>}
        </fieldset>
      </>}
    </div>
  </Modal>;
}

function ReviewHistory({ followUpCount }: { followUpCount: number }) {
  const [followUp, setFollowUp] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const history = useAsync(() => getDuplicateHistory(cursor, followUp), [cursor, followUp]);
  const [selected, setSelected] = useState<DuplicateReviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const removed = selected?.records.find(r => r.key === selected.removedKey);
  async function undo() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try { await undoDuplicate(selected); setSelected(null); setNotice("ההחלטה בוטלה. הבדיקה והסכומים מתעדכנים."); void history.reload(); }
    catch (e) { setError(apiErrorMessage(e)); void history.reload(); }
    finally { setBusy(false); }
  }
  return <section id="duplicate-history" tabIndex={-1}><Card title="החלטות ומעקב">
    {followUpCount > 0 && <p role="status">{followUpCount} קבוצות חיובים ממתינות לבירור מול המנפיק. הן עדיין נכללות בסכומים.</p>}
    <label className="household-consent"><input type="checkbox" checked={followUp} onChange={e => { setFollowUp(e.target.checked); setCursors([undefined]); }} />רק חיובים שממתינים לבירור</label>
    {notice && <p role="status">{notice}</p>}
    {history.loading && <p role="status">טוען החלטות…</p>}
    {history.error && <div role="alert"><p>{history.error}</p><Button variant="outline" onClick={() => void history.reload()}>ניסיון נוסף</Button></div>}
    {history.data && <><ul className="duplicate-history">{history.data.items.map(review => <li key={review.id}>
      <div><h3>{decisions[review.decision]}</h3><p>{review.records[0]?.name} · {formatDate(review.createdAt)}</p><span className={`duplicate-status duplicate-status-${review.status}`}>{statuses[review.status]}</span></div>
      <details><summary>הרישומים וההחלטה</summary><Records records={review.records} removedKey={review.removedKey} />{review.recordCount > review.records.length && <p>מוצגות {review.records.length} מתוך {review.recordCount} רשומות. הרשומות שנבחרו לתיקון מוצגות בראש הרשימה.</p>}{review.keptKey && <p>הרישום שנשאר: {review.keptKey}</p>}{review.undoneAt && <p>בוטלה בתאריך {formatDate(review.undoneAt)}</p>}{review.undoBlockedReason && <p>{review.undoBlockedReason}</p>}</details>
      {review.canUndo && <Button variant="outline" disabled={history.loading || Boolean(history.error)} onClick={() => { setSelected(review); setError(""); }}>{review.removedKey ? "ביטול התיקון ושחזור" : "פתיחה מחדש לבדיקה"}</Button>}
    </li>)}</ul>{!history.loading && !history.data.items.length && <p>{followUp ? "אין חיובים שסומנו לבירור." : "כאן יישמרו ההחלטות שלכם, עם אפשרות לפתוח מחדש או לשחזר תיקון."}</p>}
      <div className="row-actions">{cursors.length > 1 && <Button variant="outline" disabled={history.loading} onClick={() => setCursors(cursors.slice(0, -1))}>החלטות קודמות</Button>}{history.data.nextCursor && <Button variant="outline" disabled={history.loading} onClick={() => setCursors([...cursors, history.data!.nextCursor!])}>עוד החלטות</Button>}</div></>}
    {selected && <Modal open title={removed ? "שחזור הרישום שהוסר" : "פתיחת ההחלטה מחדש"} onClose={() => { if (!busy) setSelected(null); }} footer={<><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>חזרה</Button><Button disabled={busy || Boolean(error)} onClick={() => void undo()}>{busy ? "מבטל החלטה…" : removed ? "אישור ושחזור הרישום" : "אישור ופתיחה מחדש"}</Button></>}>
      {removed ? <><Records records={[removed]} removedKey={removed.key} /><p>הרישום יוחזר עם פרטיו המקוריים. {removed.kind === "income" ? "ההכנסות" : "ההוצאות"} לחודש {formatMonthKey(removed.date.slice(0, 7))} יגדלו ב־{formatCurrency(removed.amount)}.</p></> : <p>הסכומים לא ישתנו. אם הרישומים עדיין מתאימות לבדיקה, הן יופיעו שוב ברשימת הרישומים הדומים.</p>}
      {error && <p role="alert">{error} סגרו את החלון כדי לבדוק את ההיסטוריה המעודכנת.</p>}
    </Modal>}
  </Card></section>;
}

export function DuplicateReview({ scan, disabled }: { scan: HouseholdSnapshot["duplicates"]; disabled: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const location = useLocation();
  useEffect(() => {
    if (["#duplicates", "#duplicate-history"].includes(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [location.hash]);
  return <>
    <section id="duplicates" tabIndex={-1}><Card title={`רישומים דומים לבדיקה · ${scan.candidateCount}`}>
      <p className="text-muted">השוו למקור, ואז בחרו אם לשמור את שתי העסקאות או לתקן רישום ידני.</p>
      {notice && <p role="status">{notice}</p>}
      {scan.limited && <p role="status">הבדיקה חלקית גם בתוך התקופה: נבדקו עד 2,000 תנועות מכל סוג.</p>}
      {scan.candidates.length ? <ul className="household-duplicates">{scan.candidates.map(candidate => <li key={candidate.id}>
        <h3>{candidate.records[0].name}</h3><p>{candidate.reason === "manual_and_card" ? "רישום ידני ופירוט כרטיס דומים" : "כמה רישומים דומים מאותו סוג"} · {candidate.recordCount} רשומות</p>
        {candidate.reopened && <p className="duplicate-status duplicate-status-stale">המקור השתנה מאז הבדיקה הקודמת</p>}
        <Records records={candidate.records.slice(0, 3)} />
        {candidate.recordCount > 3 && <p>ועוד {candidate.recordCount - 3} רשומות. כל הרשומות יוצגו לפני האישור.</p>}
        <Button disabled={disabled} onClick={() => setSelected(candidate.id)}>בדיקת הרישומים</Button>
      </li>)}</ul> : <p>אין רישומים שממתינים לבדיקה הזאת. ההחלטות שכבר נשמרו מופיעות בהמשך.</p>}
      {scan.candidateCount > scan.candidates.length && <p>מוצגות 50 הקבוצות הראשונות. קבוצות נוספות יוצגו לאחר השלמת הבדיקה שלהן.</p>}
      <details><summary>היקף הבדיקה</summary><p>{formatDate(scan.from)}–{formatDate(scan.to)} · {scan.scanned} רשומות נסרקו.</p><p>נבדקות הוצאות ידניות, הכנסות לא מקושרות ורכישות בכרטיס אשראי מפירוטים שאושרו. לא נכללים תשלומים, מימון, זיכויים, רשומות מקושרות לבנק או התאמות לפי שמות דומים בלבד. זו אינה בדיקה מלאה של כל הכפילויות האפשריות. בדיקת דוחות חופפים והתאמת חיובי בנק נשארות במסכי הייבוא והחשבונות.</p></details>
    </Card></section>
    <ReviewHistory followUpCount={scan.followUpCount ?? 0} />
    {selected && <ReviewDialog key={selected} id={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setNotice("ההחלטה נשמרה בהיסטוריה. הרשימה והסכומים מתעדכנים."); }} />}
  </>;
}
