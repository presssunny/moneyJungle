import { DuplicateReview } from "../components/assistant/DuplicateReview";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { getHouseholdSnapshot, requestHouseholdPlan } from "../services/householdAssistant.service";
import type { AssistantPlan } from "../types/models";
import { formatCurrency, formatDate, formatMonthKey } from "../utils/format";
import "../styles/household-assistant.css";

export default function HouseholdAssistantPage() {
  const resource = useAsync(getHouseholdSnapshot, []);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");

  async function prioritize(version: string) {
    setBusy(true); setError("");
    try { setPlan(await requestHouseholdPlan(version)); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }

  return <div className="journey-page household-assistant">
    <div className="household-heading"><div><h2>עושים סדר בכסף של המשפחה</h2><p className="text-muted">מה דורש בדיקה, ומה כדאי לעשות עכשיו.</p></div><Button variant="outline" disabled={resource.loading || busy} onClick={() => { setPlan(null); void resource.reload(); }}>רענון הבדיקה</Button></div>
    <AsyncSection resource={resource} errorTitle="לא הצלחנו להכין את הבדיקה" skeleton={<Loading />}>
      {data => {
        const currentPlan = plan?.version === data.version && plan.mode !== "stale" ? plan : null;
        const actions = currentPlan ? currentPlan.actionIds.flatMap(id => data.actions.filter(a => a.id === id)) : data.actions.slice(0, 3);
        return <>
          {!data.hasActivity && <Card title="נתחיל עם המידע שלכם"><p>העלו דוח או הזינו הכנסות והוצאות. העוזר יוכל לבדוק רק מידע שנרשם בחשבון.</p><Link className="btn btn-primary" to="/onboarding">בניית תמונת הכסף</Link></Card>}
          <Card title={`החודש כפי שנרשם · ${formatMonthKey(data.month)}`}>
            <dl className="household-numbers">
              <div><dt>הכנסות</dt><dd dir="ltr">{formatCurrency(data.totals.incomeTotal)}</dd></div>
              <div><dt>הוצאות</dt><dd dir="ltr">{formatCurrency(data.totals.expenseTotal)}</dd></div>
              <div><dt>פנוי להמשך החודש · לפי המידע הקיים</dt><dd>{data.allowance.amount === null ? "עדיין לא ידוע" : <bdi>{formatCurrency(data.allowance.amount)}</bdi>}</dd></div>
            </dl>
            {data.blockers.length > 0 && <p className="text-muted">התמונה חלקית. הסכומים הרשומים אינם מאשרים שכל הפעילות נכללה.</p>}
            <details><summary>מה נכלל בבדיקה?</summary><p>ההוצאות כוללות פירוט אשראי מאושר לפי חודש השיוך שלו. חיובים קרובים מוצגים בנפרד; אין לחבר אותם שוב לסכום ההוצאות.</p>{data.blockers.length > 0 && <><h3>מידע להשלמה</h3><ul>{data.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></>}<Link to="/data">בדיקת המקורות והעדכניות</Link></details>
          </Card>
          <Card title="הצעדים הבאים">
            {actions.length ? <ol className="household-actions">{actions.map((action, index) => <li key={action.id}><div><h3>{action.title}</h3><p className="text-muted">{action.reason}</p></div><Link className={`btn ${index === 0 ? "btn-primary" : "btn-outline"}`} to={action.to}>לבדיקה</Link></li>)}</ol> : <p>לא נמצאה פעולה דחופה במידע הרשום. אפשר לעבור על המטרות והתקציב בבדיקה השבועית.</p>}
            {data.actionCount > actions.length && <Link to="/review">לכל הפריטים לבדיקה</Link>}
            <details className="household-ai"><summary>בחירת צעדים בעזרת AI</summary><p>בגרסה הראשונה ה־AI עוזר לבחור מתוך הפעולות שכבר נמצאו. הוא אינו מחשב סכומים ואינו משנה רשומות.</p>
              {data.aiAvailable ? <><label className="household-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />אישור לשלוח ל־Claude סוגי ממצאים ועדיפויות בלבד, ללא שמות, סכומים, מסמכים או פרטי חשבון.</label><Button disabled={!consent || busy || resource.loading || Boolean(resource.error) || !data.actions.length} onClick={() => void prioritize(data.version)}>{busy ? "בוחר צעדים…" : "בחירת צעדים עם AI"}</Button></> : <p>חיבור ה־AI עדיין לא מוגדר. הבדיקות והצעדים שמוצגים כאן פועלים גם בלעדיו.</p>}
              {error && <p role="alert">{error}</p>}
              <p role="status">{plan?.mode === "stale" || plan && plan.version !== data.version ? "המידע השתנה. יש לרענן ולבחור צעדים מחדש." : currentPlan?.mode === "ai" ? "הצעדים נבחרו בעזרת AI. בדיקות דחופות נשארו בראש הרשימה." : currentPlan?.mode === "rules" ? "ה־AI לא היה זמין או שלא התקבלה בחירה תקינה. מוצג סדר הבדיקה הרגיל." : "לא נשלח מידע ל־AI ללא הפעלה מפורשת."}</p>
            </details>
          </Card>
          <DuplicateReview scan={data.duplicates} disabled={resource.loading || Boolean(resource.error)} />
          <Card title="חיובים קרובים וחובות פתוחים">
            {data.upcoming.length ? <ul className="household-upcoming">{data.upcoming.slice(0, 8).map(event => <li key={event.key}><div><Link to={event.to}>{event.name}</Link><span className="text-muted">{formatDate(event.date)}</span></div><bdi>{event.amount === null ? "סכום לא ידוע" : formatCurrency(event.amount)}</bdi></li>)}</ul> : <p>אין חיובים קרובים במידע הרשום. בדקו שגם תשלומים שנתיים ותקופתיים נכללו.</p>}
            <Link to="/commitments">לכל ההתחייבויות</Link>
          </Card>
          <div className="row-actions"><Link to="/check-in">הבדיקה השבועית</Link><Link to="/budgets">התקציב המשפחתי</Link><Link to="/accounts?tab=savings">מטרות וחיסכון</Link></div>
          <p className="text-muted">הבדיקה הוכנה ב־{new Date(data.generatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}. המידע שייך לחשבון המחובר.</p>
        </>;
      }}
    </AsyncSection>
  </div>;
}
