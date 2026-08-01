import { Navigate } from "react-router-dom";
import { LoginForm } from "../components/gate/LoginForm";
import { themeBrand, useTheme } from "../context/ThemeContext";
import { useGateAuth } from "../hooks/useGateAuth";

/**
 * The way into the app. Single-user today: identity is verified by one backend
 * module (`modules/gate/credentials.ts`), so adding real users, MFA or a social
 * provider later changes that module and this form's fields — not the session
 * handling, the routes, or any of the 99 protected endpoints.
 */
export default function LoginPage() {
  const { login, loading, error, isLoggedIn } = useGateAuth();
  const { theme } = useTheme();

  if (isLoggedIn()) return <Navigate to="/" replace />;

  return (
    <div className="gate-page">
      <div className="gate-card">
        <div className="gate-mark" aria-hidden>
          🌴
        </div>
        <div className="gate-logo">{themeBrand(theme)}</div>
        <h1 className="gate-title">ברוכה הבאה</h1>
        <p className="gate-sub">התחברי כדי להמשיך לניהול הפיננסי המשפחתי</p>

        <LoginForm onSubmit={login} loading={loading} error={error} />

        <p className="gate-foot">החיבור נשמר — לא תצטרכי להתחבר מחדש בכל רענון</p>
      </div>
    </div>
  );
}
