import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "../common/Icon";

interface LoginFormProps {
  onSubmit: (email: string, password: string) => void;
  loading: boolean;
  error: string | null;
}

/** The reveal toggle is a real button that never submits, and says its state via aria-pressed. */
export function LoginForm({ onSubmit, loading, error }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit(email.trim(), password);
  }
  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));

  return (
    <form className="gate-form" onSubmit={handleSubmit} noValidate aria-busy={loading}>
      <div>
        <label className="gate-field-label" htmlFor="login-email">אימייל</label>
        <div className="gate-field-control">
          <input id="login-email" className="gate-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" autoFocus
            aria-invalid={Boolean(error)} placeholder="name@example.com" />
        </div>
      </div>

      <div>
        <label className="gate-field-label" htmlFor="login-password">סיסמה</label>
        <div className="gate-field-control">
          <input id="login-password" className="gate-input gate-input-with-toggle" type={revealed ? "text" : "password"}
            value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={watchCaps} onKeyDown={watchCaps}
            autoComplete="current-password" dir="ltr" aria-invalid={Boolean(error)} aria-describedby={capsLock ? "login-caps" : undefined} />
          <button type="button" className="gate-reveal" onClick={() => setRevealed((v) => !v)} aria-pressed={revealed}
            aria-label={revealed ? "הסתרת הסיסמה" : "הצגת הסיסמה"} title={revealed ? "הסתרת הסיסמה" : "הצגת הסיסמה"}>
            <Icon name={revealed ? "eye-off" : "eye"} size={20} />
          </button>
        </div>
        {capsLock && <p id="login-caps" className="gate-hint">Caps Lock פעיל</p>}
      </div>

      <div role="alert">
        {error && <p className="gate-error"><Icon name="alert" size={18} />{error}</p>}
      </div>

      <button className="gate-button" type="submit" disabled={!canSubmit && !loading} aria-busy={loading}>
        {loading && <span className="gate-spinner" aria-hidden />}
        {loading ? "נכנסים…" : "כניסה"}
      </button>
    </form>
  );
}
