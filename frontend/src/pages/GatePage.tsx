import { Navigate } from "react-router-dom";
import { GatePasswordForm } from "../components/gate/GatePasswordForm";
import { themeBrand, useTheme } from "../context/ThemeContext";
import { useGateAuth } from "../hooks/useGateAuth";

export default function GatePage() {
  const { login, loading, error, isLoggedIn } = useGateAuth();
  const { theme } = useTheme();

  if (isLoggedIn()) return <Navigate to="/" replace />;

  return (
    <div className="gate-page">
      <div className="gate-card">
        <div className="gate-logo">{themeBrand(theme)}</div>
        <h1 className="gate-title">כניסה למערכת ניהול פיננסי</h1>
        <GatePasswordForm onSubmit={login} loading={loading} error={error} />
      </div>
    </div>
  );
}
