/**
 * A flow that cannot finish returns what it DID work out (`says`, `facts`) plus
 * what it needs (`questions`). Stateless on purpose: the client re-sends the file
 * with `answers`, so no server session or buffered upload survives a restart.
 */

export type AssistantAnswerKind = "choice" | "confirm" | "number" | "text";

export interface AssistantOption {
  value: string;
  label: string;
  /** Why this option might be the right one — shown small, under the label. */
  hint?: string;
}

export interface AssistantQuestion {
  /** Stable id the client echoes back in `answers`. */
  code: string;
  /** The question, in plain Hebrew. */
  text: string;
  kind: AssistantAnswerKind;
  options?: AssistantOption[];
  /**
   * What the app believes the answer is. A question with a suggestion is a
   * confirmation ("this looks like X — right?"), which is far less work for the
   * user than an open choice.
   */
  suggestion?: string;
  /** Set when the flow can continue without an answer. */
  optional?: boolean;
}

export interface AssistantFact {
  label: string;
  value: string;
}

/** One turn. `done` = finished · `needs_answers` = blocked · `info` = finished with a remark. */
export interface AssistantStep {
  status: "done" | "needs_answers" | "info";
  /** Narration, in order: "קראתי את הקובץ", "מצאתי 53 תנועות", … */
  says: string[];
  facts: AssistantFact[];
  questions: AssistantQuestion[];
}

export type AssistantAnswers = Record<string, string>;

/** Read an answer the client echoed back, ignoring blanks. */
export function answerOf(answers: AssistantAnswers | undefined, code: string): string | undefined {
  const value = answers?.[code];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Parse `answers` off a multipart body, where everything arrives as a string. */
export function readAnswers(raw: unknown): AssistantAnswers {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isAnswerRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isAnswerRecord(raw) ? raw : {};
}

function isAnswerRecord(value: unknown): value is AssistantAnswers {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}
