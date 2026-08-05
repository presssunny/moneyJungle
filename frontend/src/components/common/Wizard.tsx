import { useState, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * One question at a time, with a running summary card that turns data entry into
 * visible progress. Steps declare their own validity, so "next" is never enabled
 * on an incomplete step and optional steps can be skipped outright.
 */

export interface WizardStep {
  /** Stable key, used for the step list and React keys. */
  key: string;
  title: string;
  /** One line under the title, explaining why this is being asked. */
  hint?: string;
  body: ReactNode;
  /** False blocks "next". Defaults to true. */
  isValid?: boolean;
  /** Shows a "דילוג" button on this step. */
  optional?: boolean;
}

interface WizardProps {
  steps: WizardStep[];
  /** The live summary card — what the app knows so far. */
  summary?: ReactNode;
  /** Runs on the last step. Should resolve once everything is saved. */
  onFinish: () => Promise<void> | void;
  onCancel: () => void;
  finishLabel?: string;
  busy?: boolean;
  error?: string | null;
}

export function Wizard({
  steps,
  summary,
  onFinish,
  onCancel,
  finishLabel = "סיום",
  busy = false,
  error,
}: WizardProps) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const canAdvance = (step?.isValid ?? true) && !busy;

  if (!step) return null;

  function next() {
    if (isLast) {
      void onFinish();
      return;
    }
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  return (
    <div className="wizard">
      {/* Progress is stated in words as well as dots — a row of circles alone
          tells a screen reader nothing. */}
      <div className="wizard-progress">
        <span className="wizard-progress-text">
          שלב {index + 1} מתוך {steps.length}
        </span>
        <div className="wizard-dots" role="presentation">
          {steps.map((item, i) => (
            <span
              key={item.key}
              className={`wizard-dot ${i === index ? "wizard-dot-active" : ""} ${
                i < index ? "wizard-dot-done" : ""
              }`}
            />
          ))}
        </div>
      </div>

      <div className="wizard-body">
        <div className="wizard-main">
          <h3 className="wizard-title">{step.title}</h3>
          {step.hint && <p className="wizard-hint">{step.hint}</p>}
          <div className="wizard-fields">{step.body}</div>
          {error && <div className="error-message">{error}</div>}
        </div>

        {summary && (
          <aside className="wizard-summary" aria-label="מה שמולא עד כה">
            {summary}
          </aside>
        )}
      </div>

      <div className="wizard-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={index === 0 ? onCancel : () => setIndex((c) => c - 1)}
          disabled={busy}
        >
          {index === 0 ? "ביטול" : "חזרה"}
        </Button>
        <div className="wizard-actions-end">
          {step.optional && !isLast && (
            <Button type="button" variant="ghost" onClick={() => setIndex((c) => c + 1)} disabled={busy}>
              דילוג
            </Button>
          )}
          <Button type="button" onClick={next} disabled={!canAdvance}>
            {busy ? "שומר..." : isLast ? finishLabel : "המשך"}
          </Button>
        </div>
      </div>
    </div>
  );
}
