import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { getCheckIn, startCheckIn, advanceCheckIn, completeCheckIn } from "../services/journey.service";
import { formatDate, formatCurrency } from "../utils/format";
export default function CheckInPage(){
 const state=useAsync(getCheckIn,[]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [finished,setFinished]=useState(false);
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();state.reload();}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <div className="journey-page"><h2>חמש דקות לתמונת הכסף</h2>{error&&<p role="alert" className="error-message">{error}</p>}{finished&&<p role="status">הבדיקה נשמרה. בפעם הבאה נשווה לתמונה הזו.</p>}<AsyncSection resource={state} errorTitle="לא ניתן לטעון את הבדיקה השבועית" skeleton={<Loading/>}>{data=>{
 const step=data.draft?.step??0;const blocked=data.status.issues.some(i=>i.blocking);
 return <><p>{data.previousCompletedAt?`הבדיקה הקודמת: ${formatDate(data.previousCompletedAt)}`:'זוהי הבדיקה הראשונה — ניצור נקודת התחלה להשוואה.'}</p><ol className="checkin-progress">{['עדכון','פתרון','הבנה','פעולה'].map((name,i)=><li key={name} aria-current={data.draft&&step===i?'step':undefined}>{name}</li>)}</ol>
 {!data.draft?<Button disabled={busy} onClick={()=>{setFinished(false);void run(startCheckIn);}}>{data.due?'תחילת הבדיקה השבועית':'בדיקה נוספת'}</Button>:<>
 {step===0&&<Card title="עדכון — האם התמונה מעודכנת?"><ul>{data.status.blockers.map(b=><li key={b}>{b}</li>)}</ul><div className="row-actions"><Link to="/imports">העלאת מידע חדש</Link><Link to="/data">בדיקת המקורות והיתרות</Link></div><p>אפשר להמשיך גם עם מגבלות ידועות. הן יישמרו לצד התמונה.</p></Card>}
 {step===1&&<Card title="פתרון — רק מה שדורש תשומת לב">{data.status.issues.length?<ul className="journey-list">{data.status.issues.map(i=><li key={i.key}><Link to={i.to}>{i.title}</Link><small>{i.blocking?'נדרש לפני המשך':'השלמת פירוט'}</small></li>)}</ul>:<p>אין פריטים שמחייבים בדיקה.</p>}</Card>}
 {step===2&&<Card title="הבנה — מה השתנה?">{data.comparison.baseline?<p>אין עדיין בדיקה קודמת להשוואה. הנתונים הנוכחיים יהיו נקודת ההתחלה.</p>:<><p>{data.comparison.added} רשומות חדשות במערכת, מתוכן {data.comparison.late} מתאריכים שקדמו לבדיקה הקודמת.</p><p>{data.comparison.changed} רשומות תוקנו · {data.comparison.removed} הוסרו.</p><p className="text-muted">מידע היסטורי שנקלט כעת אינו הוצאה חדשה השבוע.</p>{data.comparison.cashChange!==null&&<p>שינוי ביתרות הבנק: {formatCurrency(data.comparison.cashChange)}</p>}</>}<h3>חיובים קרובים</h3><ul>{data.status.events.filter(e=>e.date>=data.status.today&&!['paid','duplicate'].includes(e.decision??'')).slice(0,5).map(e=><li key={e.key}>{e.name} · {formatDate(e.date)} · {e.amount===null?'סכום לא ידוע':formatCurrency(e.amount)}</li>)}</ul>{data.status.blockers.length>0&&<p>התמונה חלקית — אין להסיק מהשינוי ברשומות שינוי מלא במצב הכספי.</p>}</Card>}
 {step===3&&<Card title="פעולה — צעד אחד להמשך"><p>{data.action.title}</p><Link to={data.action.to}>פתיחת הפעולה</Link><p className="text-muted">הפעולה תישמר עם הבדיקה. אין שינוי אוטומטי בתשלומים או בתקציב.</p></Card>}
 {step<3?<Button disabled={busy||(step===1&&blocked)} onClick={()=>run(()=>advanceCheckIn(data.draft!.id,step+1))}>המשך</Button>:<Button disabled={busy||blocked} onClick={()=>run(async()=>{await completeCheckIn(data.draft!.id,data.token);setFinished(true);})}>שמירת הבדיקה והצעד הבא</Button>}
 </>}</>;
 }}</AsyncSection></div>;
}
