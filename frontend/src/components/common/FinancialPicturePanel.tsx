import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from './Card';
import { Button } from './Button';
import { Input } from './Input';
import { saveSituation } from '../../services/journey.service';
import { apiErrorMessage } from '../../services/api';
import type { FinancialPicture, Situation } from '../../types/picture.types';
import { formatMonthKey, formatDate } from '../../utils/format';
import '../../styles/picture.css';

const icons:Record<string,string>={bank:'🏦',credit:'💳',loan:'📅',manual:'✎',income:'↙'};
const statuses:Record<string,string>={known:'יש מידע',missing:'חסר מידע',review:'לבדיקה',update:'כדאי לעדכן',estimate:'לפי הערכה'};

export function SituationForm({picture,onSaved,guided=false}:{picture:FinancialPicture;onSaved?:()=>void;guided?:boolean}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();const form=new FormData(event.currentTarget);
  const count=(key:string)=>form.get(key)===''?null:Number(form.get(key));
  const input:Situation={bankAccounts:count('bankAccounts'),creditCards:count('creditCards'),loans:count('loans'),cashActivity:form.get('cashActivity')===''?null:form.get('cashActivity')==='yes'};
  setBusy(true);setError('');try{await saveSituation(input);onSaved?.();}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}
 }
 const form = <form onSubmit={submit} className={guided?"mj-onboarding-form":undefined}>
   <div className="picture-questions">{picture.areas.map(area=><Input key={area.key} name={area.key} type="number" min="0" max="100" step="1" label={guided?area.title:`${area.title} · ${area.actual} כבר ברשימה`} defaultValue={area.expected??(area.actual||'')} placeholder={guided?"0 אם אין": "כמה יש לך? 0 אם אין"}/>)}
    <label className="picture-cash">יש גם הוצאות במזומן או מחוץ לדוחות?<select name="cashActivity" defaultValue={picture.situation?.cashActivity==null?'':picture.situation.cashActivity?'yes':'no'}><option value="">עדיין לא בטוח/ה</option><option value="yes">כן</option><option value="no">לא</option></select></label>
   </div>
   <Button className={guided?"mj-onboarding-cta":undefined} disabled={busy} type="submit">{busy?'שומרים…':guided?'שמירה והמשך':'שמירת התמונה שלי'}</Button>
   {error&&<p role="alert" className="error-message">{error}</p>}
  </form>;
 if(guided)return form;
 return <details className="picture-situation" id="situation" open={!picture.inventoryKnown||undefined}>
  <summary>{picture.inventoryKnown?'מה כלול בתמונה שלי? · שינוי':'נתחיל ממה שיש לך'}</summary>
  <p>המידע שכבר הוספת נשמר. אפשר להשאיר שדה ריק אם לא בטוחים, ולשנות בכל זמן.</p>
  {form}
 </details>;
}

export function FinancialPicturePanel({picture,compact=false,onSaved}:{picture:FinancialPicture;compact?:boolean;onSaved?:()=>void}){
 const next=picture.next;const usefulNext=next&&next.priority<80;
 if(compact&&picture.sufficient&&!usefulNext)return <p className="picture-quiet"><span>✓ המידע נבדק להיום</span><Link to="/onboarding">מה כלול בתמונה שלי?</Link></p>;
 const title=picture.stage==='empty'?'בונים יחד את תמונת הכסף שלך':picture.stage==='reviewed'?'התמונה נבדקה להיום':picture.stage==='maintain'?'נשמור על התמונה מעודכנת':'התמונה שלך כבר מתחילה להתבהר';
 return <div className="financial-picture">
  <Card className="picture-lead">
   <div className="picture-heading"><span aria-hidden="true">◎</span><div><p className="picture-kicker">{picture.hasUsefulData?'אפשר כבר לעקוב אחרי המידע שנרשם':'בקצב שלך, לפי מה שרלוונטי לך'}</p><h2>{compact&&picture.stage==='maintain'?'עדכון שכדאי לבדוק':title}</h2></div></div>
   {next?<div className="picture-next"><h3>{next.title}</h3><p>{next.reason}</p><Link className="btn btn-primary btn-md" to={next.to}>{next.id==='situation'?'נתחיל מהתמונה שלי':'לצעד הבא'} <span aria-hidden="true">←</span></Link></div>:<p>אין כרגע השלמה נדרשת. אפשר להמשיך לעקוב ולהוסיף מידע כשמשהו משתנה.</p>}
   {compact&&<Link className="picture-more" to="/onboarding">מה כבר ידוע ומה עוד חסר?</Link>}
  </Card>
  {!compact&&<>
   <SituationForm key={JSON.stringify(picture.situation)} picture={picture} onSaved={onSaved}/>
   <section aria-label="מה כבר בתמונה" className="picture-areas">
    {picture.areas.map(area=><div key={area.key}><strong>{area.title}</strong><span>{area.actual?`${area.actual} ברשימה${area.expected&&area.expected>area.actual?` מתוך ${area.expected}`:''}`:area.status==='not_applicable'?'לא רלוונטי כרגע':area.status==='unknown'?'עוד לא ידוע':'עדיין חסר'}</span>{area.actual===0&&area.status==='not_applicable'?<small>נעדכן אם יתווסף מידע חדש</small>:<Link to={area.actual?area.to:area.importTo}>{area.actual?'לרשימה':'הוספת מידע'} ←</Link>}</div>)}
   </section>
   {!!picture.sources.length&&<section aria-label="המידע שכבר הוספת" className="picture-source-grid">{picture.sources.map(source=><Card key={source.key} className={`picture-source picture-source-${source.status}`}>
    <div className="picture-source-heading"><h3><span aria-hidden="true">{icons[source.kind]}</span> {source.name}</h3><span className="picture-badge">{statuses[source.status]}</span></div>
    <p>{source.summary}</p>
    {source.count>0&&<small>{source.kind==='loan'?`${source.count} תשלומים בלוח`:`${source.count} תנועות רשומות`}</small>}
    {source.months.length>0&&<details><summary>{source.kind==='loan'?'חודשים בלוח התשלומים':'חודשים עם מידע'} · {source.months.length}</summary><div className="picture-months">{source.months.map(month=><span key={month}>{formatMonthKey(month)}</span>)}</div><p>תאריכים ברשימה אינם הוכחה שכל הפעילות בתקופה נרשמה.</p>{source.gaps.length>0&&<p>אין תנועות רשומות ב־{source.gaps.map(formatMonthKey).join(', ')}. אפשר להשלים אם היתה פעילות.</p>}</details>}
    {source.asOf&&<small>היתרה ידועה ל־{formatDate(source.asOf)}</small>}
    <Link to={source.to}>{source.kind==='manual'||source.kind==='income'?'לפעילות הרשומה':'הוספה או עדכון'} ←</Link>
   </Card>)}</section>}
   <Card className="picture-capabilities"><h2>מה אפשר לדעת כבר עכשיו?</h2><ul>{picture.capabilities.map(cap=><li key={cap.key}><span aria-hidden="true">{cap.available?'✓':'○'}</span><div><strong>{cap.title} · {cap.available?'אפשר להתחיל':'עדיין חסר מידע'}</strong><p>{cap.reason}</p></div></li>)}</ul></Card>
   <details className="picture-explainer"><summary>למה צריך גם בנק וגם אשראי?</summary><p>הבנק מראה את הירידה מהחשבון, והכרטיס מפרט את הרכישות. כשיש התאמה, החיוב בבנק אינו נספר שוב כהוצאה. אם אין התאמה ברורה, נבקש לבדוק.</p><p>דוחות חופפים נבדקים מול התנועות הקיימות. מידע חסר אינו נחשב לאפס, ותאריך שעבר אינו אומר שחוב שולם.</p></details>
  </>}
 </div>;
}
