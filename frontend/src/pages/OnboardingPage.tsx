import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PRODUCT_NAME } from "../app/brand";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { api, apiErrorMessage } from "../services/api";
import { getFinancialStatus, listImportSessions, finishOnboarding } from "../services/journey.service";
import "../styles/onboarding.css";

async function getProgress() {
  const [data, sessions] = await Promise.all([getFinancialStatus(), listImportSessions()]);
  return { data, sessions };
}

const steps = [
  { title: "מוסיפים מידע", hint: "דוח ראשון או הזנה ידנית", to: "/imports", icon: "↥" },
  { title: "בודקים יחד", hint: "עוברים על מה שנוסף", to: "/review", icon: "✓" },
  { title: "רואים את התמונה", hint: "מאשרים שהמידע מעודכן", to: "/data", icon: "◎" },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const state = useAsync(getProgress, []);
  const [reviewed, setReviewed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Coverage is still confirmed only on /data. The server owns completion.
  async function finish() {
    setBusy(true);
    setError("");
    try {
      await finishOnboarding(empty);
      navigate("/", { replace: true });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function defer() {
    setBusy(true);
    setError("");
    try {
      await api.post("/journey/onboarding/defer");
      navigate("/");
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="journey-page mj-onboarding">
      <header className="mj-onboarding-welcome">
        <span className="mj-onboarding-brand">ברוכים הבאים ל־<bdi>{PRODUCT_NAME}</bdi></span>
        <h1>נעשה סדר בכסף, צעד אחר צעד</h1>
        <p>שלושה צעדים קטנים לתמונה ברורה יותר.</p>
      </header>

      <AsyncSection resource={state} errorTitle="לא הצלחנו לטעון את ההתקדמות" skeleton={<Loading label="רגע, בודקים איפה עצרנו…" />}>
        {({ data, sessions }) => {
          const manual = !!data.profile.scope?.manualOnly;
          const pending = data.issues.filter(issue => issue.blocking);
          const started = manual || sessions.some(session => ["review", "completed"].includes(session.status));
          // These are presentation states, not new completion requirements.
          const ready = !!data.profile.scope && data.coverageAcknowledged && pending.length === 0;
          const current = ready ? 3 : !started ? 0 : pending.length ? 1 : 2;
          const resume = pending.find(issue => issue.to.startsWith("/imports"));
          const action = current === 0
            ? { title: resume ? "נמשיך עם הדוח שלך" : "מתחילים עם המידע שלך", description: resume ? "נשלים את הפרטים ונעבור על הדוח יחד." : "אפשר להעלות דוח בנק, אשראי או קובץ הוצאות.", label: resume ? "המשך העלאת הדוח" : "העלאת דוח ראשון", to: resume?.to ?? "/imports" }
            : current === 1
              ? { title: "עוד בדיקה קטנה", description: pending.length === 1 ? "נשאר פריט אחד לבדיקה לפני שממשיכים." : `נשארו ${pending.length} פריטים לבדיקה לפני שממשיכים.`, label: "לבדיקת הנתונים", to: "/review" }
              : { title: "כמעט שם, מבט אחרון", description: "נבדוק שהחשבונות, הכרטיסים והתשלומים שלך מעודכנים.", label: "לבדיקת המידע שלי", to: "/data" };

          return <>
            <nav className="mj-onboarding-progress" aria-label="שלבי ההיכרות">
              <div className="mj-onboarding-progress-caption">
                <span>{current === 3 ? "נשאר רק לסיים" : `שלב ${current + 1} מתוך 3`}</span>
                <span>{Math.min(current, 3)} מתוך 3 הושלמו</span>
              </div>
              <ol className="mj-onboarding-stepper">
                {steps.map((step, index) => {
                  const status = index < current ? "done" : index === current ? "current" : "upcoming";
                  return <li key={step.to} className={`mj-onboarding-step mj-onboarding-step-${status}`}>
                    <Link to={step.to} aria-current={status === "current" ? "step" : undefined}>
                      <span className="mj-onboarding-step-number" aria-hidden="true">{status === "done" ? "✓" : index + 1}</span>
                      <span className="mj-onboarding-step-copy"><strong>{step.title}</strong><small>{step.hint}</small></span>
                      <span className="mj-onboarding-step-status">{status === "done" ? "הושלם" : status === "current" ? "עכשיו" : "בהמשך"}</span>
                    </Link>
                  </li>;
                })}
              </ol>
            </nav>

            <Card className="mj-onboarding-action">
              <div className="mj-onboarding-action-icon" aria-hidden="true">{ready ? "✓" : steps[current].icon}</div>
              <div className="mj-onboarding-action-content">
                <span className="mj-onboarding-eyebrow">{ready ? "השלבים הושלמו" : "הצעד הבא שלך"}</span>
                <h2>{ready ? "התמונה הראשונה שלך מוכנה" : action.title}</h2>
                <p className="mj-onboarding-description">{ready ? "אפשר לסיים ולהתחיל לעקוב אחר הכסף שלך." : action.description}</p>
                {ready ? <>
                  <label className="mj-onboarding-confirm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
                    <span>בדקתי את הנתונים וברור לי מה עדיין חסר</span>
                  </label>
                  {manual && <label className="mj-onboarding-confirm"><input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)} />
                    <span>אין כרגע פעילות לרישום — אתחיל להזין בהמשך</span>
                  </label>}
                  <Button className="mj-onboarding-cta" disabled={busy || !reviewed || !data.profile.scope || !data.coverageAcknowledged || data.issues.some(issue => issue.blocking)} onClick={finish}>
                    {busy ? "מסיימים…" : "סיום ההיכרות"}<span aria-hidden="true">←</span>
                  </Button>
                </> : <>
                  <Link className="btn btn-primary btn-md mj-onboarding-cta" to={action.to}>{action.label}<span aria-hidden="true">←</span></Link>
                  {current === 0 && <Link className="mj-onboarding-manual" to="/data">מעדיפים להזין ידנית?</Link>}
                </>}
                {error && <p role="alert" className="error-message">{error}</p>}
              </div>
            </Card>

            {data.blockers.length > 0 && <details className="mj-onboarding-details">
              <summary>פרטים נוספים <span>מה עדיין חסר בתמונה</span></summary>
              <ul>{data.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
              <Link to="/data">לכל פרטי המידע שלי ←</Link>
            </details>}
          </>;
        }}
      </AsyncSection>
      {error && !state.data && <p role="alert" className="error-message">{error}</p>}
      <footer className="mj-onboarding-footer"><span>אפשר להמשיך בקצב שלך.</span><Button variant="ghost" disabled={busy} onClick={defer}>להמשיך מאוחר יותר</Button></footer>
    </div>
  );
}
