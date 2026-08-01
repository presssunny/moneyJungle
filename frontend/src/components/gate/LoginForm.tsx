import { useState, type FormEvent } from "react";

interface LoginFormProps {
  onSubmit: (username: string, password: string) => void;
  loading: boolean;
  error: string | null;
}

/**
 * User name + password, with the password revealable.
 *
 * The reveal toggle is a real `<button type="button">` so it never submits the
 * form, and it announces its state through `aria-pressed` rather than only
 * swapping an icon — the icon alone says nothing to a screen reader.
 */
export function LoginForm({ onSubmit, loading, error }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit(username.trim(), password);
  }

  return (
    <form className="gate-form" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="gate-field-label" htmlFor="login-username">
          שם משתמש
        </label>
        <div className="gate-field-control">
          <input
            id="login-username"
            className="gate-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            autoFocus
          />
        </div>
      </div>

      <div>
        <label className="gate-field-label" htmlFor="login-password">
          סיסמה
        </label>
        <div className="gate-field-control">
          <input
            id="login-password"
            className="gate-input gate-input-with-toggle"
            type={revealed ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
          />
          <button
            type="button"
            className="gate-reveal"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            aria-label={revealed ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
            title={revealed ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
          >
            <span aria-hidden>{revealed ? "🙈" : "👁️"}</span>
          </button>
        </div>
      </div>

      {/* Always rendered so the card keeps its height and does not jump. */}
      <div className="gate-error" role="alert">
        {error && (
          <>
            <span aria-hidden>⚠️</span>
            {error}
          </>
        )}
      </div>

      <button className="gate-button" type="submit" disabled={!canSubmit}>
        {loading ? "מתחבר..." : "כניסה"}
      </button>
    </form>
  );
}
