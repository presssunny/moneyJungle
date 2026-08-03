import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import type { AssistantAnswers, AssistantStep } from "../../types/assistant";

/**
 * The app talking, instead of failing.
 *
 * Any flow that returns an `AssistantStep` can be rendered here: it narrates
 * what happened line by line, shows the facts it worked out, and — when it is
 * stuck — asks the one thing it needs rather than throwing a red error.
 *
 * It holds no conversation state of its own. The caller owns the file and
 * re-submits it with the answers, which is what keeps the whole flow stateless
 * and restart-proof.
 */

interface AssistantPanelProps {
  step: AssistantStep;
  /** Called with every answer once the user submits. */
  onAnswer: (answers: AssistantAnswers) => void;
  /** True while the resubmission is in flight. */
  busy?: boolean;
  /** Rendered under a finished step — e.g. "לאישור העסקאות ←". */
  footer?: React.ReactNode;
}

const TONE: Record<AssistantStep["status"], { icon: string; className: string }> = {
  done: { icon: "✅", className: "assistant-done" },
  info: { icon: "💬", className: "assistant-info" },
  needs_answers: { icon: "❓", className: "assistant-asking" },
};

export function AssistantPanel({ step, onAnswer, busy = false, footer }: AssistantPanelProps) {
  const [answers, setAnswers] = useState<AssistantAnswers>({});
  const { icon, className } = TONE[step.status];

  // A new step is a new question set; stale answers must not leak into it.
  useEffect(() => {
    setAnswers({});
  }, [step]);

  const required = step.questions.filter((q) => !q.optional);
  const canSubmit = required.every((q) => (answers[q.code] ?? "").trim() !== "") && !busy;

  function set(code: string, value: string) {
    setAnswers((current) => ({ ...current, [code]: value }));
  }

  return (
    <section className={`assistant ${className}`} aria-live="polite">
      <div className="assistant-head">
        <span className="assistant-avatar" aria-hidden>
          {icon}
        </span>
        <div className="assistant-says">
          {step.says.map((line, index) => (
            <p key={index} className="assistant-line" style={{ animationDelay: `${index * 70}ms` }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      {step.facts.length > 0 && (
        <dl className="assistant-facts">
          {step.facts.map((fact) => (
            <div key={fact.label} className="assistant-fact">
              <dt>{fact.label}</dt>
              <dd className="mono">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {step.questions.length > 0 && (
        <div className="assistant-questions">
          {step.questions.map((question) => (
            <fieldset key={question.code} className="assistant-question">
              <legend className="assistant-question-text">
                {question.text}
                {question.optional && <span className="text-muted"> (אפשר גם לדלג)</span>}
              </legend>

              {question.kind === "choice" && (
                <div className="assistant-options">
                  {question.options?.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`assistant-option ${
                        answers[question.code] === option.value ? "assistant-option-active" : ""
                      }`}
                      aria-pressed={answers[question.code] === option.value}
                      onClick={() => set(question.code, option.value)}
                    >
                      <span className="assistant-option-label">{option.label}</span>
                      {option.hint && <span className="assistant-option-hint">{option.hint}</span>}
                    </button>
                  ))}
                </div>
              )}

              {question.kind === "confirm" && (
                <div className="assistant-options">
                  {[
                    { value: "yes", label: "כן" },
                    { value: "no", label: "לא" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`assistant-option ${
                        answers[question.code] === option.value ? "assistant-option-active" : ""
                      }`}
                      aria-pressed={answers[question.code] === option.value}
                      onClick={() => set(question.code, option.value)}
                    >
                      <span className="assistant-option-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {(question.kind === "number" || question.kind === "text") && (
                <Input
                  type={question.kind === "number" ? "number" : "text"}
                  step={question.kind === "number" ? "0.01" : undefined}
                  // The suggestion is a placeholder, never a prefilled value: a
                  // reconstructed figure must not be confirmed by accident.
                  placeholder={question.suggestion ? `למשל ${question.suggestion}` : undefined}
                  value={answers[question.code] ?? ""}
                  onChange={(e) => set(question.code, e.target.value)}
                  aria-label={question.text}
                />
              )}
            </fieldset>
          ))}

          <div className="assistant-actions">
            <Button onClick={() => onAnswer(answers)} disabled={!canSubmit}>
              {busy ? "רגע..." : step.status === "needs_answers" ? "המשך" : "שמירה"}
            </Button>
            {step.questions.every((q) => q.optional) && (
              <Button variant="ghost" onClick={() => onAnswer({})} disabled={busy}>
                דילוג
              </Button>
            )}
          </div>
        </div>
      )}

      {footer && <div className="assistant-footer">{footer}</div>}
    </section>
  );
}
