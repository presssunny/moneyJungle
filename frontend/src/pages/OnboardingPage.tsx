import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PRODUCT_NAME } from '../app/brand';
import { SituationForm } from '../components/common/FinancialPicturePanel';
import { AsyncSection } from '../components/common/AsyncSection';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Loading } from '../components/common/Loading';
import { useAsync } from '../hooks/useAsync';
import { getFinancialStatus, finishOnboarding } from '../services/journey.service';
import { apiErrorMessage } from '../services/api';
import type { PictureAction } from '../types/picture.types';
import '../styles/onboarding.css';

const steps = [
  { title: 'מכירים את הכסף', hint: 'מה יש לך היום', to: '#situation' },
  { title: 'מוסיפים ובודקים', hint: 'המידע שלך, במקום אחד', to: '/imports' },
  { title: 'רואים את התמונה', hint: 'מבט אחרון ויוצאים לדרך', to: '/data' },
];

function actionLabel(action: PictureAction) {
  if (action.id.startsWith('session:')) return 'להמשך הדוח';
  if (action.to.startsWith('/imports')) return 'להוספת דוח';
  if (action.id.startsWith('balance:')) return 'לעדכון היתרה';
  if (action.id === 'manual') return 'להוספת הוצאה';
  if (action.id === 'scope' || action.id === 'acknowledge') return 'לבדיקת המידע שלי';
  if (action.to.startsWith('/accounts')) return 'לבדיקת החשבונות';
  if (action.to.startsWith('/commitments')) return 'לבדיקת התשלומים';
  return 'לבדיקת הפרטים';
}

export default function OnboardingPage() {
  const state = useAsync(getFinancialStatus, []);
  const navigate = useNavigate();
  const [reviewed, setReviewed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function finish() {
    setBusy(true);
    setError('');
    try {
      await finishOnboarding(empty);
      navigate('/');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <div className="journey-page mj-onboarding">
    <header className="mj-onboarding-welcome">
      <span className="mj-onboarding-brand">ברוכים הבאים ל־<bdi>{PRODUCT_NAME}</bdi></span>
      <h1>נעשה סדר בכסף, יחד</h1>
      <p>שלושה צעדים קטנים. בקצב שלך.</p>
    </header>
    <AsyncSection resource={state} errorTitle="לא הצלחנו לטעון את התמונה שלך" skeleton={<Loading label="רגע, בודקים איפה עצרנו…" />}>
      {data => {
        const picture = data.picture;
        if (!picture) return <Card><h2>נמשיך עם המידע שלך</h2><Link className="btn btn-primary btn-md mj-onboarding-cta" to="/data">לבדיקת המידע שלי</Link></Card>;
        const ready = picture.sufficient;
        const next = picture.next;
        // Visual progress only. All financial readiness and completion rules remain server-owned.
        const current = ready ? 3 : !picture.inventoryKnown ? 0
          : picture.requiredGaps.length || data.issues.some(i => i.blocking) || (next && next.priority < 35) ? 1 : 2;
        const canFinish = ready && data.profile.onboarding !== 'completed' && data.profile.onboarding !== 'legacy';
        const title = current === 0 ? 'נתחיל ממה שיש לך'
          : ready ? 'אפשר לצאת לדרך' : next?.title ?? 'מבט אחרון על המידע';
        const description = current === 0 ? 'כמה חשבונות, כרטיסים והלוואות יש לך? אפשר לעדכן בהמשך.'
          : ready ? 'המידע נבדק להיום. אפשר להמשיך לבית שלך.'
          : current === 1 ? 'נשלים בכל פעם דבר אחד, ונמשיך יחד.' : 'נבדוק מה כבר נוסף ומה עוד צריך להשלים.';
        return <>
          <nav aria-label="שלבי ההיכרות">
            <div className="mj-onboarding-progress-caption"><span>{ready ? 'שלושת הצעדים הושלמו' : `צעד ${current + 1} מתוך 3`}</span><span>כל צעד מקרב לתמונה ברורה יותר</span></div>
            <ol className="mj-onboarding-stepper">
              {steps.map((step, index) => {
                const status = index < current ? 'done' : index === current ? 'current' : 'upcoming';
                return <li key={step.title} className={`mj-onboarding-step mj-onboarding-step-${status}`}>
                  <Link to={index === current ? '#onboarding-action' : step.to} aria-current={status === 'current' ? 'step' : undefined}>
                    <span className="mj-onboarding-step-number" aria-hidden="true">{status === 'done' ? '✓' : index + 1}</span>
                    <span className="mj-onboarding-step-copy"><strong>{step.title}</strong><small>{step.hint}</small></span>
                    <span className="mj-onboarding-step-status">{status === 'done' ? 'הושלם' : status === 'current' ? 'עכשיו' : 'בהמשך'}</span>
                  </Link>
                </li>;
              })}
            </ol>
          </nav>

          <div id="onboarding-action" className="mj-onboarding-anchor">
            <Card className="mj-onboarding-action">
              <div className="mj-onboarding-action-icon" aria-hidden="true">{ready ? '✓' : current === 0 ? '◎' : current === 1 ? '↥' : '✓'}</div>
              <div className="mj-onboarding-action-content">
                <span className="mj-onboarding-eyebrow">{ready ? 'נעים לראות את התמונה מתבהרת' : 'הצעד הבא שלך'}</span>
                <h2 tabIndex={-1} id="onboarding-action-title">{title}</h2>
                <p className="mj-onboarding-description">{description}</p>
                {current === 0 ? <div id="situation" className="mj-onboarding-initial">
                  <SituationForm guided key={JSON.stringify(picture.situation)} picture={picture} onSaved={() => { state.reload(); document.getElementById('onboarding-action-title')?.focus(); }} />
                  <span className="mj-onboarding-form-hint">לא בטוחים? אפשר להשאיר שדה ריק.</span>
                </div> : canFinish ? <div className="mj-onboarding-finish">
                  <label className="mj-onboarding-confirm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />בדקתי את הנתונים וברור לי מה עדיין חסר</label>
                  {data.profile.scope?.manualOnly && !data.hasActivity && <label className="mj-onboarding-confirm"><input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)} />אין כרגע פעילות לרישום — אתחיל להזין בהמשך</label>}
                  <Button className="mj-onboarding-cta" disabled={busy || !reviewed || !data.coverageAcknowledged || data.issues.some(i => i.blocking)} onClick={finish}>{busy ? 'שומרים…' : 'סיום ההיכרות'}<span aria-hidden="true">←</span></Button>
                </div> : <Link className="btn btn-primary btn-md mj-onboarding-cta" to={ready ? '/' : next?.to ?? '/data'}>{ready ? 'לבית שלי' : next ? actionLabel(next) : 'לבדיקת המידע שלי'}<span aria-hidden="true">←</span></Link>}
                {!ready && <Link className="mj-onboarding-manual" to="/data">מעדיפים להזין ידנית?</Link>}
                {error && <p role="alert" className="error-message">{error}</p>}
              </div>
            </Card>
          </div>

          {picture.inventoryKnown && <section className="mj-onboarding-overview" aria-label="מה כבר בתמונה">
            <div className="mj-onboarding-section-heading"><h2>התמונה שלך, בינתיים</h2><a href="#situation">עדכון הפרטים</a></div>
            <div className="mj-onboarding-areas">{picture.areas.map((area, index) => <Card key={area.key} className="mj-onboarding-area">
              <span className="mj-onboarding-area-icon" aria-hidden="true">{['▤', '▱', '◷'][index]}</span>
              <h3>{area.title}</h3>
              <span className="mj-onboarding-area-count">{area.actual > 0 ? area.actual : area.status === 'not_applicable' ? '—' : '0'}<small>{area.expected && area.expected > area.actual ? ` מתוך ${area.expected}` : area.actual > 0 ? ' נוספו' : ''}</small></span>
              <span className={`mj-onboarding-badge ${area.actual > 0 && !(area.expected && area.expected > area.actual) ? 'mj-onboarding-badge-added' : ''}`}>{area.expected !== null && area.expected > area.actual ? 'נשאר להוסיף' : area.actual > 0 ? '✓ ברשימה' : area.status === 'not_applicable' ? 'אין כרגע' : 'עוד לא הוספנו'}</span>
              {area.status !== 'not_applicable' && <Link to={area.actual ? area.to : area.importTo}>{area.actual ? 'לפרטים' : 'הוספת מידע'}<span aria-hidden="true"> ←</span></Link>}
            </Card>)}</div>
          </section>}

          <details className="mj-onboarding-details">
            <summary>פרטים נוספים<span>מה ידוע ומה אפשר להשלים</span></summary>
            {next && !ready && <p>{next.reason}</p>}
            {!!picture.requiredGaps.length && <ul>{picture.requiredGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
            <ul>{picture.capabilities.map(cap => <li key={cap.key}><strong>{cap.title}</strong><p>{cap.reason}</p></li>)}</ul>
            {!!data.blockers.length && <ul>{data.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
            <Link to="/data">לכל המידע והדוחות שלי ←</Link>
          </details>
          {picture.inventoryKnown && <SituationForm key={JSON.stringify(picture.situation)} picture={picture} onSaved={state.reload} />}
        </>;
      }}
    </AsyncSection>
    <footer className="mj-onboarding-footer"><Link to="/">להמשיך לבית עם המידע הקיים</Link><span>אפשר לחזור ולהשלים בכל זמן.</span></footer>
  </div>;
}
