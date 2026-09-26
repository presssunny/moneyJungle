import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage } from "../../services/api";
import { askHouseholdQuestion } from "../../services/householdAssistant.service";
import type { QuestionAnswer } from "../../types/models";
import { Button } from "../common/Button";

interface AskBoxProps {
  /** Scopes the question to one uploaded file. */
  documentId?: number;
  aiAvailable?: boolean;
  initialQuestion?: string;
}

const MODE_NOTE: Record<QuestionAnswer["mode"], string> = {
  rules: "נענה מתוך המידע הרשום, בלי שליחה החוצה.",
  ai: "העוזר החכם זיהה את סוג השאלה; הסכומים חושבו כאן, מתוך המידע הרשום.",
  unanswered: "",
};

export function AskBox({ documentId, aiAvailable = false, initialQuestion = "" }: AskBoxProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(text: string) {
    if (text.trim().length < 2) return;
    setBusy(true); setError("");
    try { setAnswer(await askHouseholdQuestion(text.trim(), consent, documentId)); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <div className="ask-box">
      <form onSubmit={submit} className="ask-form">
        <label className="field-label" htmlFor={documentId ? `ask-${documentId}` : "ask-household"}>
          {documentId ? "שאלה על הקובץ" : "שאלה על הכסף שלכם"}
        </label>
        <div className="ask-row">
          <input
            id={documentId ? `ask-${documentId}` : "ask-household"}
            className="field-input"
            value={question}
            maxLength={300}
            placeholder={documentId ? "כמה ריבית יש בדף הזה?" : "כמה הוצאתי החודש על מזון?"}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" disabled={busy || question.trim().length < 2}>{busy ? "בודק…" : "שאלה"}</Button>
        </div>
        {aiAvailable && (
          <label className="household-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            אם השאלה לא תזוהה כאן, מותר לשלוח ל־Claude את נוסח השאלה בלבד — בלי סכומים, תנועות, קבצים או פרטי חשבון — כדי לזהות את סוג השאלה.
          </label>
        )}
      </form>
      {error && <p role="alert" className="field-error">{error}</p>}
      {answer && (
        <section className="ask-answer" aria-live="polite">
          <p className="ask-answer-text">{answer.answer}</p>
          {answer.facts.length > 0 && (
            <dl className="ask-facts">
              {answer.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd><bdi>{f.display}</bdi></dd></div>)}
            </dl>
          )}
          {answer.limitations.length > 0 && <ul className="ask-limitations text-muted">{answer.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
          {answer.links.length > 0 && <div className="row-actions">{answer.links.map((l) => <Link key={l.to} to={l.to}>{l.label} ←</Link>)}</div>}
          {answer.examples.length > 0 && (
            <div className="ask-examples">
              <span className="text-muted">אפשר לשאול למשל:</span>
              {answer.examples.map((example) => (
                <Button key={example} size="sm" variant="outline" type="button" onClick={() => { setQuestion(example); void ask(example); }}>{example}</Button>
              ))}
            </div>
          )}
          {MODE_NOTE[answer.mode] && <p className="text-muted ask-mode">{MODE_NOTE[answer.mode]}</p>}
        </section>
      )}
    </div>
  );
}
