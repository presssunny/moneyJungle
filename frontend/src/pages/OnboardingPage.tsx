import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ONBOARDED_KEY } from "../app/RequireOnboarding";
import { themeBrand, useTheme } from "../context/ThemeContext";
import { completeOnboarding, getSettings } from "../services/planning.service";

interface Step {
  icon: string;
  title: string;
  desc: string;
  cta: string;
  to: string;
}

const STEPS: Step[] = [
  {
    icon: "🎯",
    title: "קביעת יעד חודשי",
    desc: "יעד הוצאות חודשי מאפשר מעקב קצב, התראות חכמות ורצף הישגים.",
    cta: "לקביעת יעד",
    to: "/manage?tab=settings",
  },
  {
    icon: "💳",
    title: "ייבוא דוח אשראי",
    desc: "העלי קובץ אקסל מחברת האשראי — הנתונים יסווגו אוטומטית לקטגוריות.",
    cta: "לייבוא אשראי",
    to: "/accounts?tab=credit",
  },
  {
    icon: "✨",
    title: "הוספה מהירה",
    desc: 'רשמי הוצאה בשפה חופשית — למשל "שופרסל 250" — והמערכת תזהה סכום וקטגוריה.',
    cta: "לדשבורד",
    to: "/",
  },
];

/** First-run welcome. Any CTA marks onboarding complete, then routes into the app. */
export default function OnboardingPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function finish(to: string) {
    if (busy) return;
    setBusy(true);
    localStorage.setItem(ONBOARDED_KEY, "1");
    try {
      const settings = await getSettings();
      await completeOnboarding(settings);
    } catch {
      /* even if the flag fails to save, don't trap the user */
    }
    navigate(to, { replace: true });
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-logo mono">
          <span aria-hidden>💰</span> {themeBrand(theme)}
        </div>
        <h1 className="onboarding-title">ברוכה הבאה! 👋</h1>
        <p className="onboarding-sub">
          שלושה צעדים קצרים כדי להפיק את המרב — אפשר לעשות אותם עכשיו או בהמשך.
        </p>

        <div className="onboarding-steps">
          {STEPS.map((step, i) => (
            <button
              key={step.to}
              type="button"
              className="onboarding-step"
              onClick={() => finish(step.to)}
              disabled={busy}
            >
              <span className="onboarding-step-num">{i + 1}</span>
              <span className="onboarding-step-icon" aria-hidden>
                {step.icon}
              </span>
              <span className="onboarding-step-body">
                <span className="onboarding-step-title">{step.title}</span>
                <span className="onboarding-step-desc">{step.desc}</span>
              </span>
              <span className="onboarding-step-cta">{step.cta} →</span>
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-ghost btn-md onboarding-skip" onClick={() => finish("/")} disabled={busy}>
          {busy ? "רגע…" : "דלגי — כניסה לדשבורד"}
        </button>
      </div>
    </div>
  );
}
