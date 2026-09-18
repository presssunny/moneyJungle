import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { MetricExplanation } from "../components/common/MetricExplanation";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { getSummary, getAttention } from "../services/dashboard.service";
import { getFinancialStatus } from "../services/journey.service";
import { currentMonthKey, formatCurrency, formatDate, formatMonthKey } from "../utils/format";
const HomeAnalysis=lazy(()=>import('../components/dashboard/HomeAnalysis'));
export default function DashboardPage(){
 const navigate=useNavigate();const {monthKey}=useMonth();const [analysis,setAnalysis]=useState(false);
 const state=useAsync(getFinancialStatus,[]);const summary=useAsync(()=>getSummary(monthKey),[monthKey]);const attention=useAsync(()=>getAttention(currentMonthKey()),[]);
 return <div className="journey-page">
  <div className="page-toolbar"><Button onClick={()=>navigate('/imports')}>עדכון מידע</Button><Button variant="outline" onClick={()=>navigate('/check-in')}>בדיקת הכסף השבועית</Button><Button variant="ghost" onClick={()=>navigate('/transactions?tab=expenses',{state:{openForm:true}})}>הוספת הוצאה</Button></div>
  <AsyncSection resource={state} errorTitle="לא ניתן לבדוק את תמונת הכסף" skeleton={<Loading/>}>{data=><>
   {['pending','deferred'].includes(data.profile.onboarding)&&<Card title="ההיכרות עדיין לא הושלמה"><Link to="/onboarding">המשך מהשלב שבו עצרת</Link></Card>}
   <Card title="איפה אנחנו עומדים היום?">
    {data.blockers.length>0?<><p className="financial-status">התמונה עדיין חלקית</p><p>אין כרגע מספיק מידע לאומדן יומי לאחר התחייבויות.</p><Link to="/data">מה חסר ואיך משלימים?</Link></>:<><p className="text-muted">אומדן לתכנון הוצאה יומית עד {formatDate(data.end)}</p><p className="financial-status mono">{formatCurrency(data.allowance.amount!)}</p>{!!data.allowance.shortfall&&<p>פער צפוי בכיסוי ההתחייבויות: {formatCurrency(data.allowance.shortfall)}</p>}</>}
    <p>יתרות בנק רשומות: <strong>{data.balances.length?formatCurrency(data.allowance.cash):'לא ידוע'}</strong></p>
    <MetricExplanation><p>{data.allowance.formula}</p><p>שריון לביטחון, חיסכון ואשראי מעבר לחודש: {formatCurrency(data.allowance.reserves)} · הוצאות חיוניות שטרם נרשמו: {formatCurrency(data.allowance.essentialReserve)}</p><ul>{data.balances.map(b=><li key={b.id}>{b.name}: {b.explanation}</li>)}{data.allowance.assumptions.map(a=><li key={a}>{a}</li>)}{data.blockers.map(b=><li key={b}>{b}</li>)}</ul><Link to="/commitments">פירוט ההתחייבויות</Link></MetricExplanation>
   </Card>
   <Card title="מה צפוי בקרוב?" action={<Link to="/commitments">לכל ההתחייבויות</Link>}>
    {(()=>{const end=new Date(data.today);end.setUTCDate(end.getUTCDate()+7);const upcoming=data.events.filter(e=>e.date>=data.today&&e.date<end.toISOString().slice(0,10)&&!['paid','duplicate'].includes(e.decision??''));return upcoming.length?<ul className="journey-list">{upcoming.slice(0,5).map(e=><li key={e.key}><Link to={e.to}>{e.name} · {formatDate(e.date)}</Link><span>{e.amount===null?'סכום לא ידוע':formatCurrency(e.amount)}{!e.decision&&' · לבדיקה'}</span></li>)}</ul>:<p>לא רשומים חיובים לשבעת הימים הקרובים. מידע חסר לא נחשב לאפס.</p>;})()}
   </Card>
  </>}</AsyncSection>
  <Card title="מה כדאי לעשות עכשיו?"><AsyncSection resource={attention} errorTitle="לא ניתן לטעון פעולות חשובות" skeleton={<Loading/>}>{items=>{
    const issues=state.data?.issues??[];const actions=[...issues.map(i=>({id:i.key,text:i.title,to:i.to})),...items];const seen=new Set<string>();const unique=actions.filter(a=>{if(seen.has(a.to))return false;seen.add(a.to);return true;});
    return <>{unique.length?<ol className="journey-steps">{unique.slice(0,3).map(a=><li key={a.id}><Link to={a.to}>{a.text}</Link></li>)}</ol>:<p>אין כרגע פעולה דחופה במידע הרשום. אפשר להתחיל בדיקה שבועית.</p>}<Link to="/review">לכל הפריטים לבדיקה</Link></>;
  }}</AsyncSection></Card>
  <QuickAddBar onAdded={()=>{state.reload();summary.reload();attention.reload();}}/>
  <Card title={`מה נרשם ב${formatMonthKey(monthKey)}?`}>
   <AsyncSection resource={summary} errorTitle="סיכום החודש לא נטען" skeleton={<Loading/>}>{data=><>
    <div className="kpi-row"><SummaryCard label="הכנסות רשומות" value={formatCurrency(data.incomeTotal)} onClick={()=>navigate('/transactions?tab=incomes')}/><SummaryCard label="הוצאות רשומות" value={formatCurrency(data.expenseTotal)} onClick={()=>navigate('/transactions?tab=expenses')}/><SummaryCard label="עודף רשום בחודש" value={formatCurrency(data.balance)} sub="הכנסות פחות הוצאות; אינו יתרת הבנק"/></div>
    <MetricExplanation title="מה נכלל בסיכום החודש?"><p>הכנסות לפי תאריך ההכנסה; הוצאות לפי תאריך ההוצאה, בתוספת עסקאות אשראי מדוחות שאושרו לפי חודש הרכישה. חיובי מימון פנימיים באשראי אינם נכללים.</p><p>הקטנת חוב: {formatCurrency(data.bankMonth.debtReduction)} · חיובי אשראי שכבר פורטו: {formatCurrency(data.bankMonth.cardSettled)} · העברות פנימיות: {formatCurrency(data.bankMonth.internalTransfer)} · הלוואות שהתקבלו: {formatCurrency(data.bankMonth.loanDrawdown)}. אלו תנועות כספיות שאינן הוצאה רגילה.</p><p>{data.bankReview.pendingCount} תנועות בנק בכל התקופות ממתינות לטיפול. קיום רשומות אינו הוכחה לכיסוי מלא של החודש.</p><Link to="/accounts?tab=reconcile">מקורות וסיווג תנועות הבנק</Link></MetricExplanation>
   </>}</AsyncSection>
  </Card>
  <details className="home-analysis" onToggle={e=>setAnalysis(e.currentTarget.open)}><summary>ניתוח נוסף — מגמות, קטגוריות ופעילות אחרונה</summary>{analysis&&<Suspense fallback={<Loading/>}><HomeAnalysis/></Suspense>}</details>
 </div>;
}
