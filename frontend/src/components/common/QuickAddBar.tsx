import { useState } from "react";
import { quickAddExpense, type QuickAddResult } from "../../services/finance.service";
import { formatCurrency } from "../../utils/format";

/**
 * Natural-language quick add: type "שופרסל 250" (or "קניתי בקפה ב-18 אתמול") and
 * the server parses the amount, business name and auto-category. Complements the
 * structured form and Excel import without needing an LLM.
 */
export function QuickAddBar({ onAdded }: { onAdded?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickAddResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await quickAddExpense(value);
      setResult(res);
      setText("");
      onAdded?.();
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "לא הצלחתי להוסיף — נסי שוב";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-add">
      <form className="quick-add-form" onSubmit={submit}>
        <span className="quick-add-icon" aria-hidden>
          ✨
        </span>
        <input
          className="quick-add-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (result) setResult(null);
            if (error) setError(null);
          }}
          placeholder='הוספה מהירה — לדוגמה: "שופרסל 250" או "קפה 18 אתמול"'
          aria-label="הוספת הוצאה מהירה בשפה חופשית"
          maxLength={255}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {busy ? "מוסיף…" : "הוספה"}
        </button>
      </form>

      {result && (
        <div className="quick-add-result">
          ✅ נוספה הוצאה: <strong>{result.parsed.businessName || "הוצאה"}</strong> ·{" "}
          <span className="mono">{formatCurrency(result.parsed.amount)}</span>
          {result.parsed.categoryName ? (
            <>
              {" "}· {result.parsed.categoryIcon ?? "🏷️"} {result.parsed.categoryName}
            </>
          ) : (
            <span className="text-muted"> · ללא קטגוריה</span>
          )}
        </div>
      )}
      {error && <div className="quick-add-error">⚠️ {error}</div>}
    </div>
  );
}
