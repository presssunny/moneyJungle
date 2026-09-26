import { Navigate } from "react-router-dom";
import { PRODUCT_NAME } from "../app/brand";
import { Icon } from "../components/common/Icon";
import { LoginForm } from "../components/gate/LoginForm";
import { useGateAuth } from "../hooks/useGateAuth";
import "../styles/gate.css";

// Only what the product actually does — no data leaves through a bank connection (CLAUDE.md §7).
const POINTS = [
  { icon: "bank", title: "כל הכסף במקום אחד", text: "דפי עו״ש, כרטיסי אשראי והלוואות, מהקבצים שכבר מורידים מהבנק" },
  { icon: "target", title: "תשובה ברורה", text: "כמה נכנס, כמה יצא ומה אפשר להוציא היום" },
  { icon: "lock", title: "בלי חיבור לחשבון הבנק", text: "אתם מעלים את הדוחות, ושום גורם לא ניגש לחשבון" },
];

export default function LoginPage() {
  const { login, loading, error, isLoggedIn } = useGateAuth();

  if (isLoggedIn()) return <Navigate to="/" replace />;

  return (
    <main className="gate-page">
      <div className="gate-shell">
        <section className="gate-brand" aria-label={PRODUCT_NAME}>
          <div className="gate-brand-head">
            <span className="gate-logo">{PRODUCT_NAME}</span>
            <span className="gate-mark" aria-hidden><Icon name="leaf" size={28} /></span>
          </div>
          <p className="gate-tagline">התמונה המלאה של הכסף המשפחתי.</p>
          <ul className="gate-points">
            {POINTS.map((point) => (
              <li key={point.title}><Icon name={point.icon} size={22} /><div><strong>{point.title}</strong><span>{point.text}</span></div></li>
            ))}
          </ul>
        </section>
        <section className="gate-panel">
          <h1 className="gate-title">כניסה לחשבון</h1>
          <p className="gate-sub">עם האימייל והסיסמה שלך.</p>
          <LoginForm onSubmit={login} loading={loading} error={error} />
          <p className="gate-foot"><Icon name="lock" size={16} />החיבור נשמר במכשיר הזה, כך שלא צריך להתחבר בכל כניסה.</p>
        </section>
      </div>
    </main>
  );
}
