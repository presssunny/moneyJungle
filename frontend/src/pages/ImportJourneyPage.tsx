import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { DropZone } from "../components/common/DropZone";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { Table } from "../components/common/Table";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { api, apiErrorMessage } from "../services/api";
import { getFinancialStatus, uploadSession, getImportSession, answerSession, actOnSession, type ImportSession } from "../services/journey.service";
import { formatCurrency, formatDate } from "../utils/format";

export default function ImportJourneyPage(){
 const [params,setParams]=useSearchParams();const id=params.get('session');
 const [session,setSession]=useState<ImportSession|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [accepted,setAccepted]=useState(false);
 const [answers,setAnswers]=useState<Record<string,string|number>>({});const [newName,setNewName]=useState('');const [lastFour,setLastFour]=useState('');
 const sources=useAsync(getFinancialStatus,[]);const loans=useAsync(async()=> (await api.get('/loans')).data.loans as Array<{id:number;loanName:string}>,[]);
 useEffect(()=>{let alive=true;setSession(null);setAccepted(false);setError('');if(id){setBusy(true);getImportSession(id).then(s=>{if(alive){setSession(s);setAnswers(s.answers??{});}}).catch(e=>{if(alive)setError(apiErrorMessage(e));}).finally(()=>{if(alive)setBusy(false);});}return()=>{alive=false;};},[id]);
 async function run(action:()=>Promise<ImportSession>){setBusy(true);setError('');try{const next=await action();setSession(next);setAnswers(next.answers??{});setAccepted(false);if(id!==next.id)setParams({session:next.id});}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 function inputNumber(key:string,value:string){setAnswers(old=>({...old,[key]:value?Number(value):''}));}
 const cleanAnswers=()=>Object.fromEntries(Object.entries(answers).filter(([,v])=>v!==''));
 async function createSource(){setBusy(true);setError('');try{
   if((answers.kind??session?.kind)==='bank'){const {data}=await api.post('/bank/accounts',{bankName:newName,accountName:newName,initialBalance:0});setAnswers(old=>({...old,accountId:data.id}));}
   else{const {data}=await api.post('/credit/cards',{name:newName,issuer:newName,lastFour});setAnswers(old=>({...old,cardId:data.id}));}
   setNewName('');sources.reload();
 }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 const kind=String(answers.kind??session?.kind??'');
 const editable=session&&['needs_input','ready_for_review'].includes(session.status);
 return <div className="journey-page">
  <p className="text-muted">העלאה ← זיהוי ועיבוד ← השלמת מידע ← בדיקה ← תמונה מעודכנת</p>
  {error&&<p role="alert" className="error-message">{error}</p>}
  {!id&&<Card title="עדכון המידע הפיננסי"><p>דוח בנק, דוח אשראי, גיליון הוצאות או לוח סילוקין. נזהה את הקובץ ונציג את הנתונים לבדיקה לפני קליטה.</p><DropZone onFile={file=>run(()=>uploadSession(file,Object.fromEntries(['accountId','cardId','loanId'].flatMap(k=>params.get(k)?[[k,Number(params.get(k))]]:[]))))} accept=".xlsx,.xls,.csv,.pdf" busy={busy}/><Link to="/data">קליטות קודמות והמשך תהליך</Link></Card>}
  {busy&&!session&&<Loading/>}
  {session&&<>
   <Card title={session.fileName}><p role="status">{({needs_input:'נדרש מידע נוסף',ready_for_review:'מוכן לבדיקה לפני קליטה',review:'נקלט — נותרה בדיקה',completed:'הקליטה והבדיקה הושלמו',cancelled:'הקליטה בוטלה'} as Record<string,string>)[session.status]??session.status}</p></Card>
   {editable&&<Card title="פרטי הקובץ">
    <Select label="סוג המידע" value={kind==='unknown'?'':kind} placeholder="בחירת סוג" options={[{value:'bank',label:'דף חשבון בנק'},{value:'credit',label:'דוח אשראי'},{value:'expense_sheet',label:'גיליון הוצאות'},{value:'loan_schedule',label:'לוח סילוקין'}]} onChange={e=>setAnswers(old=>({...old,kind:e.target.value}))}/>
    <AsyncSection resource={sources} errorTitle="לא ניתן לטעון חשבונות וכרטיסים" skeleton={<Loading/>}>{data=><>
     {kind==='bank'&&<Select label="חשבון בנק" value={answers.accountId??''} placeholder="בחירת חשבון" options={data.balances.map(a=>({value:a.id,label:a.name}))} onChange={e=>inputNumber('accountId',e.target.value)}/>}
     {kind==='credit'&&<Select label="כרטיס אשראי" value={answers.cardId??''} placeholder="בחירת כרטיס" options={data.cards.map(c=>({value:c.id,label:c.name}))} onChange={e=>inputNumber('cardId',e.target.value)}/>}
     {['bank','credit'].includes(kind)&&<details><summary>הוספת {kind==='bank'?'חשבון בנק':'כרטיס'}</summary><Input label="שם" value={newName} onChange={e=>setNewName(e.target.value)}/>{kind==='credit'&&<Input label="ארבע ספרות אחרונות" maxLength={4} value={lastFour} onChange={e=>setLastFour(e.target.value)}/>}<Button disabled={busy||!newName||(kind==='credit'&&!/^\d{4}$/.test(lastFour))} onClick={createSource}>יצירה ובחירה</Button></details>}
    </>}</AsyncSection>
    {kind==='loan_schedule'&&<Select label="הלוואה קיימת (אם אין זיהוי חד־משמעי בקובץ)" value={answers.loanId??''} placeholder="זיהוי לפי מספר ההלוואה בקובץ" options={(loans.data??[]).map(l=>({value:l.id,label:l.loanName}))} onChange={e=>inputNumber('loanId',e.target.value)}/>}
    {kind==='expense_sheet'&&<Input label="חודש לשורות ללא תאריך" type="month" value={answers.month??''} onChange={e=>setAnswers(old=>({...old,month:e.target.value}))}/>}
    <Button disabled={busy||!kind||kind==='unknown'} onClick={()=>run(()=>answerSession(session,cleanAnswers()))}>בדיקת הפרטים</Button>
   </Card>}
   {session.preview&&<Card title={`נמצאו ${session.preview.count} שורות`}>
    {session.preview.questions.map((q,i)=><p key={i} role="status">{q}</p>)}
    {session.preview.warnings.length>0&&<details open><summary>מה חשוב לבדוק</summary><ul>{session.preview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
    <Table rows={session.preview.rows.map((r,i)=>({...r,id:i}))} rowKey={r=>r.id} columns={[{key:'date',header:'תאריך',render:r=>r.date?formatDate(r.date):'ללא תאריך — לפי החודש שנבחר'},{key:'name',header:'תיאור',render:r=>r.name},{key:'amount',header:'סכום',render:r=>formatCurrency(r.amount)}]}/>
   </Card>}
   {session.status==='ready_for_review'&&<Card title="אישור קליטה"><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> בדקתי את השורות ואת ההערות, ובחרתי את המקור הנכון</label><div className="row-actions"><Button disabled={busy||!accepted||JSON.stringify(cleanAnswers())!==JSON.stringify(session.answers??{})} onClick={()=>run(()=>actOnSession(session,'commit'))}>{busy?'קולט…':'קליטת הנתונים'}</Button></div></Card>}
   {session.status==='review'&&<Card title="השלמת הבדיקה"><p>הנתונים נקלטו. יש לבדוק את התוצאה לפני סיום התהליך.</p><div className="row-actions">
    <Link to={session.result?.creditImportId?`/accounts?tab=credit&importId=${session.result.creditImportId}`:session.kind==='bank'?'/accounts?tab=reconcile':session.kind==='loan_schedule'?'/accounts?tab=loans':'/transactions?tab=expenses'}>פתיחת הנתונים לבדיקה</Link>
    <Button disabled={busy} onClick={()=>run(()=>actOnSession(session,'complete'))}>בדקתי — סיום הקליטה</Button>
   </div></Card>}
   {editable&&<Button variant="ghost" disabled={busy} onClick={()=>run(()=>actOnSession(session,'cancel'))}>ביטול הקליטה לפני החלת הנתונים</Button>}
   {session.status==='completed'&&<Card title="התמונה עודכנה"><div className="row-actions"><Link to="/onboarding">השלמת ההיכרות</Link><Link to="/check-in">המשך בדיקה שבועית</Link><Link to="/">לתמונת הכסף</Link><Button variant="outline" onClick={()=>setParams({})}>העלאת קובץ נוסף</Button></div></Card>}
   {session.status==='cancelled'&&<Button onClick={()=>setParams({})}>העלאת קובץ חדש</Button>}
  </>}
 </div>;
}
