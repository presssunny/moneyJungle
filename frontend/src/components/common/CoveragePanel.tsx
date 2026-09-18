import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "./Card";
import { Button } from "./Button";
import { Input } from "./Input";
import { api, apiErrorMessage } from "../../services/api";
import { saveProfile, confirmCoverage, type FinancialStatus } from "../../services/journey.service";
import { formatCurrency } from "../../utils/format";
export function CoveragePanel({data,onSaved}:{data:FinancialStatus;onSaved:()=>void}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState('');
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');setSaved('');try{await action();setSaved('נשמר');onSaved();}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <>
  <Card title="המקורות שבתמונה"><p>יש לרשום את כל חשבונות הבנק, הכרטיסים וההתחייבויות הרלוונטיים לפני אישור העדכניות. אפשר להמשיך עם תמונה חלקית; היא תסומן בהתאם.</p>
   <div className="row-actions"><Link to="/imports">העלאת מידע</Link><Link to="/accounts?tab=bank">ניהול חשבונות</Link><Link to="/accounts?tab=credit">ניהול כרטיסים</Link><Link to="/commitments">בדיקת התחייבויות</Link></div>
   {data.balances.map(b=><form key={b.id} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void run(()=>api.post(`/bank/accounts/${b.id}/anchor`,{balance:Number(form.get('balance')),asOf:data.today}));}} className="coverage-account"><strong>{b.name}: {formatCurrency(b.balance)}</strong><p className="text-muted">{b.explanation}</p><Input name="balance" label={`יתרה לפי הבנק היום — ${b.name}`} type="number" step="0.01" required/><Button disabled={busy} type="submit" variant="outline">עדכון יתרה להיום</Button></form>)}
   <form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void run(()=>saveProfile({scope:{accountsListed:true,cardsListed:true,commitmentsListed:true,manualOnly:form.get('manual')==='on'},cashBuffer:Number(form.get('buffer')),essentialReserve:Number(form.get('essential')),savedReserve:Number(form.get('saved'))}));}}>
    <p><label><input type="checkbox" required defaultChecked={!!data.profile.scope}/> בדקתי שכל החשבונות, הכרטיסים וההתחייבויות הרלוונטיים רשומים</label></p>
    <p><label><input type="checkbox" name="manual" defaultChecked={data.profile.scope?.manualOnly}/> אני בוחר/ת בהזנה ידנית במקום העלאת דוחות</label></p>
    <div className="form-row"><Input name="buffer" label="כרית ביטחון להשארה בחשבון (₪)" type="number" min="0" step="0.01" defaultValue={data.profile.cashBuffer} required/><Input name="essential" label="הוצאות חיוניות שטרם נרשמו עד סוף החודש (₪)" type="number" min="0" step="0.01" defaultValue={data.profile.essentialReserve} required/><Input name="saved" label="כסף מתוך הבנק ששוריין לחיסכון (₪)" type="number" min="0" step="0.01" defaultValue={data.profile.savedReserve} required/></div>
    <p className="text-muted">יש לשריין רק סכומים שלא נכללו כבר ברשימת ההתחייבויות. יעד חיסכון לבדו אינו העברה שבוצעה.</p>
    <Button type="submit" disabled={busy}>שמירת היקף התמונה והסכומים</Button>
   </form>
   {error&&<p role="alert" className="error-message">{error}</p>}{saved&&<p role="status">{saved}</p>}
  </Card>
  <Card title="עדכניות המידע"><ul>{data.blockers.map(b=><li key={b}>{b}</li>)}</ul><p>אישור זה מתייחס למקורות שהזנת נכון ל־{data.today}. לאחר שינוי בנתונים או ביום חדש נבקש לבדוק שוב.</p><Button disabled={busy||!data.profile.scope} onClick={()=>run(()=>confirmCoverage(data.dataVersion))}>בדקתי — המידע מעודכן להיום</Button></Card>
 </>;
}
