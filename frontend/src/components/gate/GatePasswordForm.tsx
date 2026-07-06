import { useState, type FormEvent } from "react";

interface GatePasswordFormProps {
  onSubmit: (password: string) => void;
  loading: boolean;
  error: string | null;
}

export function GatePasswordForm({ onSubmit, loading, error }: GatePasswordFormProps) {
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.trim()) onSubmit(password);
  }

  return (
    <form className="gate-form" onSubmit={handleSubmit}>
      <input
        className="gate-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="סיסמה"
        autoFocus
        aria-label="סיסמה"
      />
      <div className="gate-error" role="alert">
        {error}
      </div>
      <button className="gate-button" type="submit" disabled={loading || !password.trim()}>
        {loading ? "מתחבר..." : "כניסה"}
      </button>
    </form>
  );
}
