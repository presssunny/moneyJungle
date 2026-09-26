import { Icon } from "../components/common/Icon";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { DropZone } from "../components/common/DropZone";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { ImportRowsReview } from "../components/common/ImportRowsReview";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { api, apiErrorMessage } from "../services/api";
import { getFinancialStatus, uploadSession, getImportSession, answerSession, actOnSession, type ImportSession } from "../services/journey.service";

const UPLOAD_TYPES = [
  { icon: "🏦", label: "דף חשבון עו״ש", hint: "ייצוא תנועות מאתר הבנק", formats: "Excel או PDF" },
  { icon: "💳", label: "פירוט עסקאות בכרטיס אשראי", hint: "מאתר חברת הכרטיס — כאל, מקס, ישראכרט", formats: "Excel" },
  { icon: "📉", label: "לוח סילוקין של הלוואה", hint: "מעמוד ההלוואה באתר הבנק", formats: "Excel" },
  { icon: "🧾", label: "רשימת הוצאות", hint: "גיליון שניהלת בעצמך", formats: "Excel או CSV" },
];

const KIND_OPTIONS = [
  { value: "bank", label: "דף חשבון עו״ש" },
  { value: "credit", label: "פירוט עסקאות בכרטיס אשראי" },
  { value: "loan_schedule", label: "לוח סילוקין של הלוואה" },
  { value: "expense_sheet", label: "רשימת הוצאות" },
];

const STATUS_TEXT: Record<string, string> = {
  failed: "לא הצלחנו לקרוא את הקובץ. אפשר לתקן את הפרטים ולנסות שוב.",
  uploaded: "הקובץ התקבל.",
  processing: "הקובץ בעיבוד. אם זה נעצר, אפשר לנסות שוב.",
  needs_input: "חסרים כמה פרטים לפני שנציג את התנועות.",
  ready_for_review: "התנועות מוכנות לבדיקה. שום דבר עוד לא נוסף.",
  review: "התנועות נוספו. נשאר לעבור עליהן ולסיים.",
  completed: "הייבוא הושלם.",
  cancelled: "הייבוא בוטל. לא נוסף דבר.",
  rolled_back: "הייבוא בוטל, והתנועות שנוספו ממנו הוסרו.",
};

type Status = Awaited<ReturnType<typeof getFinancialStatus>>;

/** What is already in the picture and what is still missing — so the household knows which file to fetch. */
function Inventory({ status }: { status: Status }) {
  const picture = status.picture;
  const sources = (picture?.sources ?? []).filter((s) => ["bank", "credit", "loan"].includes(s.kind));
  const missing = (picture?.areas ?? []).filter((a) => a.status === "missing");
  if (!sources.length && !missing.length) return <p className="text-muted">עוד לא הועלו דוחות. אפשר להתחיל מכל אחד מהסוגים.</p>;
  return (
    <div className="import-inventory">
      {sources.length > 0 && (
        <div>
          <h3 className="import-inventory-title">כבר במערכת</h3>
          <ul>{sources.map((s) => <li key={s.key}><Icon name="check" size={16} /><span><strong>{s.name}</strong> <span className="text-muted">· {s.summary}</span></span></li>)}</ul>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <h3 className="import-inventory-title">חסר כדי שהתמונה תהיה מלאה</h3>
          <ul>{missing.map((a) => <li key={a.key}><span aria-hidden>•</span><span><strong>{a.title}</strong> <span className="text-muted">· {a.actual} מתוך {a.expected} שציינת</span></span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

// Each session gets a fresh screen, so nothing from the previous one has to be reset.
export default function ImportJourneyPage(){
 const [params]=useSearchParams();const id=params.get('session');
 return <ImportJourney key={id??'new'}/>;
}

function ImportJourney(){
 const [params,setParams]=useSearchParams();const id=params.get('session');
 const [session,setSession]=useState<ImportSession|null>(null);const [busy,setBusy]=useState(Boolean(id));const [error,setError]=useState('');const [accepted,setAccepted]=useState(false);
 const [answers,setAnswers]=useState<Record<string,string|number>>({});const [newName,setNewName]=useState('');const [lastFour,setLastFour]=useState('');
 const sources=useAsync(getFinancialStatus,[]);const loans=useAsync(async()=> (await api.get('/loans')).data.loans as Array<{id:number;loanName:string}>,[]);
 useEffect(()=>{let alive=true;if(id){getImportSession(id).then(s=>{if(alive){setSession(s);setAnswers(s.answers??{});}}).catch(e=>{if(alive)setError(apiErrorMessage(e));}).finally(()=>{if(alive)setBusy(false);});}return()=>{alive=false;};},[id]);
 async function run(action:()=>Promise<ImportSession>){setBusy(true);setError('');try{const next=await action();setSession(next);setAnswers(next.answers??{});setAccepted(false);if(id!==next.id)setParams({session:next.id});}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 function inputNumber(key:string,value:string){setAnswers(old=>({...old,[key]:value?Number(value):''}));}
 const cleanAnswers=()=>Object.fromEntries(Object.entries(answers).filter(([,v])=>v!==''));
 async function createSource(){setBusy(true);setError('');try{
   if((answers.kind??session?.kind)==='bank'){const {data}=await api.post('/bank/accounts',{bankName:newName,accountName:newName,initialBalance:0});setAnswers(old=>({...old,accountId:data.id}));}
   else{const {data}=await api.post('/credit/cards',{name:newName,issuer:newName,lastFour});setAnswers(old=>({...old,cardId:data.id}));}
   setNewName('');sources.reload();
 }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 const kind=String(answers.kind??session?.kind??'');
 const editable=session&&['uploaded','processing','failed','needs_input','ready_for_review'].includes(session.status);
 return <div className="journey-page import-journey-page">
  <ol className="flow-progress" aria-label="שלבי העלאת דוח">{['העלאה','בדיקה ואישור','סיום'].map((label,index)=>{const current=session?.status==='completed'?2:id&&!['cancelled','rolled_back'].includes(session?.status??'')?1:0;return <li key={label} aria-current={index===current?'step':undefined} data-state={index<current?'done':index===current?'current':'upcoming'}><span className="flow-step-number" aria-hidden="true">{index<current?<Icon name="check" size={18}/>:index+1}</span><span>{label}</span></li>;})}</ol>
  {error&&<p role="alert" className="error-message">{error}</p>}
  {!id&&<Card title="איזה דוח מעלים?">
   <p className="text-muted">מורידים את הקובץ מאתר הבנק או חברת הכרטיס ומעלים אותו כאן. הסוג מזוהה אוטומטית, ושום דבר לא נוסף לפני שבודקים ומאשרים.</p>
   <DropZone onFile={file=>run(()=>uploadSession(file,Object.fromEntries(['accountId','cardId','loanId'].flatMap(k=>params.get(k)?[[k,Number(params.get(k))]]:[]))))} accept=".xlsx,.xls,.csv,.pdf" title="גררי לכאן את הקובץ או לחצי לבחירה" hint="Excel, CSV או PDF" busy={busy}/>
   <h3 className="import-inventory-title">מה אפשר להעלות</h3>
   <ul className="upload-kinds">
    {UPLOAD_TYPES.map(t=><li key={t.label} className="upload-kind"><Icon name={t.icon} size={20}/><div><strong>{t.label}</strong><span className="text-muted">{t.hint}</span><span className="upload-kind-format">{t.formats}</span></div></li>)}
   </ul>
   <AsyncSection resource={sources} errorTitle="לא הצלחנו לבדוק מה כבר קיים" skeleton={<Loading/>}>{data=><Inventory status={data}/>}</AsyncSection>
   <Link to="/data">דוחות שהועלו בעבר</Link></Card>}
  {busy&&!session&&<Loading/>}
  {session&&<>
   <Card title={session.fileName}><p role="status">{STATUS_TEXT[session.status]??session.status}</p></Card>
   {session.error&&<p role="alert">{session.error}</p>}
   {editable&&<Card title="פרטי הקובץ">
    <Select label="סוג הדוח" value={kind==='unknown'?'':kind} placeholder="בחירת סוג" options={KIND_OPTIONS} onChange={e=>setAnswers(old=>({...old,kind:e.target.value}))}/>
    <AsyncSection resource={sources} errorTitle="לא ניתן לטעון חשבונות וכרטיסים" skeleton={<Loading/>}>{data=><>
     {kind==='bank'&&<Select label="חשבון בנק" value={answers.accountId??''} placeholder="בחירת חשבון" options={data.balances.map(a=>({value:a.id,label:a.name}))} onChange={e=>inputNumber('accountId',e.target.value)}/>}
     {kind==='credit'&&<Select label="כרטיס אשראי" value={answers.cardId??''} placeholder="בחירת כרטיס" options={data.cards.map(c=>({value:c.id,label:c.name}))} onChange={e=>inputNumber('cardId',e.target.value)}/>}
     {['bank','credit'].includes(kind)&&<details><summary>{kind==='bank'?'החשבון לא ברשימה? הוספת חשבון':'הכרטיס לא ברשימה? הוספת כרטיס'}</summary><Input label={kind==='bank'?'שם החשבון (למשל: עו״ש משפחתי)':'שם הכרטיס (למשל: ויזה כאל)'} value={newName} onChange={e=>setNewName(e.target.value)}/>{kind==='credit'&&<Input label="4 הספרות האחרונות של הכרטיס" inputMode="numeric" maxLength={4} value={lastFour} onChange={e=>setLastFour(e.target.value)}/>}<Button disabled={busy||!newName||(kind==='credit'&&!/^\d{4}$/.test(lastFour))} onClick={createSource}>הוספה</Button></details>}
    </>}</AsyncSection>
    {kind==='loan_schedule'&&<Select label="לאיזו הלוואה שייך הלוח?" value={answers.loanId??''} placeholder="זיהוי אוטומטי לפי מספר ההלוואה" options={(loans.data??[]).map(l=>({value:l.id,label:l.loanName}))} onChange={e=>inputNumber('loanId',e.target.value)}/>}
    {kind==='expense_sheet'&&<Input label="לאיזה חודש לשייך שורות בלי תאריך?" type="month" value={answers.month??''} onChange={e=>setAnswers(old=>({...old,month:e.target.value}))}/>}
    <p className="text-muted">שינוי הפרטים מחזיר את השורות למצבן המקורי, ותיקונים שעשית בהן יתבטלו.</p>
    <Button disabled={busy||!kind||kind==='unknown'} onClick={()=>run(()=>answerSession(session,cleanAnswers()))}>המשך לבדיקת התנועות</Button>
   </Card>}
   {session.preview&&<Card title={`נמצאו ${session.preview.count} תנועות`}>
    {session.preview.questions.map((q,i)=><p key={i} role="status">{q}</p>)}
    {session.preview.warnings.length>0&&<details open><summary>לפני שמאשרים</summary><ul>{session.preview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
    <ImportRowsReview session={session} onSaved={next=>{setSession(next);setAccepted(false);}}/>
   </Card>}
   {session.status==='ready_for_review'&&<Card title="אישור והוספה"><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> בדקתי את התנועות ואת ההערות, והקובץ שייך לחשבון או לכרטיס הנכון</label><div className="row-actions"><Button disabled={busy||!accepted||JSON.stringify(cleanAnswers())!==JSON.stringify(session.answers??{})} onClick={()=>run(()=>actOnSession(session,'commit'))}>{busy?'מוסיף…':'הוספת התנועות'}</Button></div></Card>}
   {session.status==='review'&&<Card title="בדיקה אחרונה"><p>התנועות נוספו. כדאי להעיף מבט בתוצאה לפני שמסיימים.</p><div className="row-actions">
    <Link to={(session.result?.creditImportId?`/accounts?tab=credit&importId=${session.result.creditImportId}`:session.kind==='bank'?'/accounts?tab=reconcile':session.kind==='loan_schedule'?'/accounts?tab=loans':'/transactions?tab=expenses')+`&returnTo=${encodeURIComponent('/imports?session='+session.id)}`}>פתיחת התנועות שנוספו</Link>
    <Button disabled={busy} onClick={()=>run(()=>actOnSession(session,'complete'))}>בדקתי — סיום</Button>
   </div></Card>}
   {editable&&<Button variant="ghost" disabled={busy} onClick={()=>run(()=>actOnSession(session,'cancel'))}>ביטול הייבוא — שום דבר לא יתווסף</Button>}
   {session.status==='completed'&&<Card title="הדוח נוסף לתמונה"><div className="row-actions"><Link to="/">לדף הבית</Link><Link to="/check-in">לבדיקה השבועית</Link><Link to="/onboarding">להמשך ההיכרות</Link><Button variant="outline" onClick={()=>setParams({})}>העלאת דוח נוסף</Button></div></Card>}
   {['cancelled','rolled_back'].includes(session.status)&&<Button onClick={()=>setParams({})}>העלאת דוח אחר</Button>}
  </>}
 </div>;
}
