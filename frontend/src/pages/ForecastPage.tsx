import { useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { SkeletonChart } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { chartChrome, tooltipStyle } from "../components/dashboard/chartTheme";
import { useAsync } from "../hooks/useAsync";
import { getForecast } from "../services/future.service";
import { emptyForecastScenario as initial, readForecastPreferences, saveForecastPreferences } from "../services/forecastPreferences";
import { formatCurrency, formatDate, formatMonthKey } from "../utils/format";
import "../styles/future.css";

const money = (value: number | null) => value === null ? "—" : formatCurrency(value);

export default function ForecastPage() {
  const [preferences] = useState(readForecastPreferences);
  const [preferenceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [draft, setDraft] = useState(preferences.scenario);
  const [scenario, setScenario] = useState(preferences.scenario);
  const [excluded, setExcluded] = useState(preferences.excluded);
  // Re-writing what was just read tells whether this browser can keep the scenario at all.
  const [saved, setSaved] = useState(() => saveForecastPreferences(preferences.scenario, preferences.excluded, preferenceMonth));
  function applyScenario(next: typeof scenario) { setScenario(next); setSaved(saveForecastPreferences(next, excluded, preferenceMonth)); }
  function applyExcluded(next: string[]) { setExcluded(next); setSaved(saveForecastPreferences(scenario, next, preferenceMonth)); }
  const [selected, setSelected] = useState(0);
  const [metric, setMetric] = useState("balance");
  const [tipHidden, setTipHidden] = useState(false);
  const resource = useAsync(() => getForecast(scenario, excluded), [scenario, excluded]);
  const chrome = chartChrome();
  const scenarioActive = scenario.monthlyIncomeChange !== 0 || scenario.monthlyExpenseChange !== 0 || scenario.oneTimeExpense !== 0;

  return <div className="future-page">
    <div className="future-heading"><div><span className="text-muted">תכנון לשנה הקרובה</span><h2>מבט קדימה</h2>
      <p>מה עשוי לקרות אם ההרגלים נשארים, ואיך שינוי קטן משפיע על השנה.</p></div><span className="future-badge">תחזית משוערת</span></div>
    <AsyncSection resource={resource} errorTitle="לא הצלחנו לטעון את התחזית" skeleton={<SkeletonChart />}>
      {(data) => {
        const month = data.months[selected];
        const commitments = data.commitments[selected];
        const chart = [
          ...data.history.map((row) => ({ monthKey: row.monthKey, actual: row.incomeTotal === 0 && row.expenseTotal === 0 ? null : row[metric as "balance" | "incomeTotal" | "expenseTotal"], estimate: null, scenario: null })),
          { monthKey: data.anchorMonth, actual: null, estimate: null, scenario: null },
          ...data.months.map((row) => ({ monthKey: row.monthKey, actual: null, estimate: row[metric as "balance" | "incomeTotal" | "expenseTotal"], scenario: metric === "balance" && scenarioActive ? row.scenarioBalance : null })),
        ];
        return <>
          <p className="text-muted">התחזית מתחילה בחודש הבא · חושב {formatDate(data.generatedAt)} · מבוסס על {data.baselineMonths.length} חודשים עם הכנסות והוצאות רשומות. כיסוי הדוחות לא אומת.</p>
          {!data.sufficient && <div className="info-banner">נדרשים לפחות שלושה חודשים עם הכנסות והוצאות כדי להציג אומדן. בינתיים אפשר לראות תשלומים רשומים בהמשך המסך. <Link to="/transactions?tab=import">השלמת נתונים</Link></div>}
          <div className="kpi-row">
            <SummaryCard label="עודף משוער בחודש הבא" value={money(data.months[0].balance)} certainty={data.sufficient ? "scenario" : "unknown"} sub="הכנסות פחות הוצאות · לא יתרת בנק" />
            <SummaryCard label="עודף משוער ב־12 חודשים" value={money(data.annualBalance)} certainty={data.sufficient ? "scenario" : "unknown"} sub="בהנחה שהממוצע ההיסטורי נמשך" />
            <SummaryCard label="החודש העמוס בהתחייבויות רשומות" value={data.heaviest ? formatMonthKey(data.heaviest.monthKey) : "—"} certainty={data.heaviest ? "scenario" : "unknown"} sub={data.heaviest ? `${money(data.heaviest.total)} · לפי הרשומות הקיימות` : "לא נמצאו התחייבויות בטווח"} />
          </div>
          <Card title="מהעבר אל השנה הקרובה" action={<Select aria-label="מדד בגרף" value={metric} onChange={(e) => setMetric(e.target.value)} options={[{ value: "balance", label: "עודף / גירעון" }, { value: "incomeTotal", label: "הכנסות" }, { value: "expenseTotal", label: "הוצאות" }]} />}>
            <p className="text-muted">קו רציף: נתונים רשומים · קו מקווקו: אומדן. החודש הנוכחי אינו נכלל בממוצע.</p>
            <ResponsiveContainer width="100%" height={290}><LineChart data={chart}>
              <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="monthKey" reversed tick={{ fill: chrome.text, fontSize: 11 }} tickFormatter={(key: string) => key.slice(2)} />
              <YAxis orientation="right" tick={{ fill: chrome.text, fontSize: 11 }} width={65} />
              <Tooltip contentStyle={tooltipStyle()} formatter={(value) => money(Number(value))} labelFormatter={(key) => formatMonthKey(String(key))} />
              <Legend />
              <Line dataKey="actual" name="רשום בפועל" stroke={chrome.success} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="estimate" name="תחזית בסיס" stroke={chrome.text} strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
              {scenarioActive && metric === "balance" && <Line dataKey="scenario" name="התרחיש שלי" stroke={chrome.danger} strokeWidth={2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />}
            </LineChart></ResponsiveContainer>
          </Card>
          <Card title="מה יקרה אם…">
            <details className="metric-explanation"><summary>שמירת התרחיש</summary><p className="text-muted">{saved ? "התרחיש שחושב ובחירת חודשי ההשוואה נשמרים בדפדפן הזה, בחשבון שלך, עד סוף החודש הנוכחי." : "השמירה בדפדפן אינה זמינה; התרחיש נשמר רק כל עוד המסך פתוח."}</p></details>
            <p className="text-muted">שינוי חודשי חל בכל 12 חודשי התחזית. מספר שלילי מציין הפחתה. ההדמיה אינה משנה עסקאות או תקציב.</p>
            <form onSubmit={(e) => { e.preventDefault(); applyScenario({ ...draft }); }}>
              <div className="future-form">
                <Input label="שינוי בהכנסה החודשית (₪)" type="number" step="0.01" min={-1000000} max={1000000} required value={draft.monthlyIncomeChange} onChange={(e) => setDraft({ ...draft, monthlyIncomeChange: Number(e.target.value) })} />
                <Input label="שינוי בהוצאה החודשית (₪)" type="number" step="0.01" min={-1000000} max={1000000} required value={draft.monthlyExpenseChange} onChange={(e) => setDraft({ ...draft, monthlyExpenseChange: Number(e.target.value) })} />
                <Input label="הוצאה חד־פעמית נוספת (₪)" type="number" step="0.01" min={0} max={10000000} required value={draft.oneTimeExpense} onChange={(e) => setDraft({ ...draft, oneTimeExpense: Number(e.target.value) })} />
                <Select label="חודש ההוצאה הנוספת" value={draft.oneTimeMonth} onChange={(e) => setDraft({ ...draft, oneTimeMonth: Number(e.target.value) })} options={data.months.map((row, i) => ({ value: i + 1, label: formatMonthKey(row.monthKey) }))} />
              </div>
              <div className="row-actions"><Button type="submit" disabled={!data.sufficient}>בדיקת ההשפעה</Button><Button type="button" variant="ghost" onClick={() => { setDraft(initial); applyScenario(initial); }}>איפוס</Button></div>
            </form>
            {scenarioActive && <p role="status">העודף השנתי בתרחיש: <strong>{money(data.scenarioAnnualBalance)}</strong> לעומת {money(data.annualBalance)} בתחזית הבסיס.</p>}
          </Card>
          <Card title="בחירת חודש לפירוט">
            <div className="future-months">{data.months.map((row, index) => <button type="button" key={row.monthKey} aria-pressed={selected === index} onClick={() => setSelected(index)} className="future-month"><span>{formatMonthKey(row.monthKey)}</span><strong>{money(scenarioActive ? row.scenarioBalance : row.balance)}</strong></button>)}</div>
            <div className="future-detail" aria-live="polite"><h3>{formatMonthKey(month.monthKey)}</h3>
              <p>הכנסה משוערת: {money(month.incomeTotal)} · הוצאה משוערת: {money(month.expenseTotal)} · עודף משוער: {money(month.balance)}</p>
              {scenarioActive && <p>עודף בתרחיש שלך: <strong>{money(month.scenarioBalance)}</strong></p>}
              <details><summary>תשלומים רשומים לחודש הזה ({commitments.events.length})</summary>
                <p className="text-muted">רשימה נפרדת שאינה מתווספת לאומדן: חלק מהחיובים כבר נכללים בעבר. יש לבדוק רישום כפול בין מנויים לתשלומים קבועים. סכומי תזכורות והלוואות עשויים להיות משוערים.</p>
                {commitments.events.length ? <ul className="future-events">{commitments.events.map((event, i) => <li key={`${event.date}-${i}`}><span>{formatDate(event.date)} · {event.name}</span><strong>{money(event.amount)}</strong></li>)}</ul> : <p>אין תשלומים רשומים לחודש הזה; אין בכך אישור שלא יהיו הוצאות.</p>}
              </details>
            </div>
          </Card>
          {!tipHidden && <Card title="צעד אחד להמשך" action={<Button variant="ghost" size="sm" onClick={() => setTipHidden(true)}>הסתרה</Button>}>
            {!data.sufficient ? <p>השלמת חודשים חסרים תאפשר להשוות תקופות בלי להניח שחודש חסר הוא חודש ללא הוצאות.</p> : data.annualBalance !== null && data.annualBalance < 0 ? <p>לפי הנתונים הרשומים, ההוצאות הממוצעות גבוהות מההכנסות. אפשר לבדוק למעלה איך שינוי חודשי משפיע על הפער.</p> : <p>אפשר לבדוק הפחתה חודשית קטנה בהוצאות ולראות כמה היא מוסיפה לעודף השנתי. עודף צפוי אינו כסף שכבר נחסך.</p>}
          </Card>}
          <Card title="איך חושבה התחזית?">
            <details><summary>הנחות ובחירת חודשי ההשוואה</summary>
              <p>ממוצע של עד שישה חודשים קודמים שבהם רשומות גם הכנסות וגם הוצאות. חודש ללא רשומות אינו נחשב לאפס. הנתונים עשויים להיות חלקיים; התחזית אינה מניחה עונתיות או צמיחה ואינה מבטיחה תוצאה.</p>
              <p>אפשר להוציא מהממוצע חודש חריג או חודש שהדוחות בו חלקיים. התחייבויות עתידיות מוצגות בנפרד; סיום הלוואה אינו מפחית אוטומטית את הממוצע. ניתן לבדוק שינוי באמצעות התרחיש.</p>
              <p>{data.backtest.monthsTested > 0 ? `בבדיקה על ${data.backtest.monthsTested} חודשים קודמים, הסטייה הממוצעת בהוצאות הייתה ${money(data.backtest.meanAbsoluteExpenseError)}. בכל חודש השתמשנו רק בחודשים שקדמו לו. זו בדיקה על הרשומות הקיימות, לא הבטחת דיוק לעתיד.` : "אין עדיין מספיק חודשים לבדיקת דיוק מול העבר."}</p>
              <div className="future-months">{data.history.map((row) => <label key={row.monthKey} className="future-month"><input type="checkbox" checked={!excluded.includes(row.monthKey)} onChange={(e) => applyExcluded(e.target.checked ? excluded.filter((key) => key !== row.monthKey) : [...excluded, row.monthKey])} />{formatMonthKey(row.monthKey)}<small>הכנסות {money(row.incomeTotal)} · הוצאות {money(row.expenseTotal)}</small></label>)}</div>
            </details>
          </Card>
        </>;
      }}
    </AsyncSection>
  </div>;
}

