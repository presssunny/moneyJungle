import { Card } from "../common/Card";
import { AsyncSection } from "../common/AsyncSection";
import { Loading } from "../common/Loading";
import { InsightsPanel } from "./InsightsPanel";
import { AchievementsPanel } from "./AchievementsPanel";
import { MonthlyTrendChart } from "./MonthlyTrendChart";
import { CategoryBarChart } from "./CategoryBarChart";
import { useMonth } from "../../context/MonthContext";
import { useAsync } from "../../hooks/useAsync";
import { getCharts, getInsights, getAchievements, getRecent } from "../../services/dashboard.service";
import { formatCurrency, formatDate } from "../../utils/format";
export default function HomeAnalysis(){
 const {monthKey}=useMonth();const charts=useAsync(()=>getCharts(monthKey),[monthKey]);const insights=useAsync(()=>getInsights(monthKey),[monthKey]);const achievements=useAsync(()=>getAchievements(monthKey),[monthKey]);const recent=useAsync(getRecent,[]);
 return <>
 <AsyncSection resource={charts} errorTitle="הניתוח לא נטען" skeleton={<Loading/>}>{data=><div className="charts-grid"><Card title="הכנסות והוצאות — שישה חודשים"><MonthlyTrendChart data={data.trend}/></Card><Card title="הוצאות לפי קטגוריה"><CategoryBarChart data={data.byCategory}/></Card></div>}</AsyncSection>
 <Card title="תובנות לפי הנתונים הרשומים"><p className="text-muted">הציון הוא מדד פנימי לפי יחס הוצאות להכנסות, תקציבים, הלוואות ויעדים. הוא אינו דירוג אשראי ואינו מעיד על שלמות הנתונים.</p><AsyncSection resource={insights} errorTitle="התובנות לא נטענו" skeleton={<Loading/>}>{data=><InsightsPanel data={data}/>}</AsyncSection></Card>
 <AsyncSection resource={achievements} errorTitle="ההישגים לא נטענו" skeleton={<Loading/>}>{data=><AchievementsPanel data={data}/>}</AsyncSection>
 <Card title="פעילות אחרונה בכל החודשים"><AsyncSection resource={recent} errorTitle="הפעילות לא נטענה" skeleton={<Loading/>}>{data=><ul className="journey-list">{[...data.expenses.map(r=>({key:`expense:${r.id}`,date:r.expenseDate,name:r.businessName||r.description||'הוצאה',amount:-Number(r.amount)})),...data.incomes.map(r=>({key:`income:${r.id}`,date:r.incomeDate,name:r.description||'הכנסה',amount:Number(r.amount)})),...data.credit.map(r=>({key:`credit:${r.id}`,date:r.transactionDate,name:r.businessName,amount:-Number(r.amount)}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(r=><li key={r.key}><span>{r.name} · {formatDate(r.date)}</span><strong>{formatCurrency(r.amount)}</strong></li>)}</ul>}</AsyncSection></Card>
 </>;
}
