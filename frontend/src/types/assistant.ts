/**
 * Mirror of `backend/src/modules/assistant/assistant.types.ts`.
 *
 * Any flow that can get stuck returns one of these instead of throwing, so the
 * UI can show a question where it used to show a red error.
 */

export type AssistantAnswerKind = "choice" | "confirm" | "number" | "text";

export interface AssistantOption {
  value: string;
  label: string;
  hint?: string;
}

export interface AssistantQuestion {
  code: string;
  text: string;
  kind: AssistantAnswerKind;
  options?: AssistantOption[];
  /** What the app believes the answer is — shown as a hint, never prefilled. */
  suggestion?: string;
  optional?: boolean;
}

export interface AssistantFact {
  label: string;
  value: string;
}

export interface AssistantStep {
  /** `needs_answers` means nothing was written and the file must be re-sent. */
  status: "done" | "needs_answers" | "info";
  says: string[];
  facts: AssistantFact[];
  questions: AssistantQuestion[];
}

export type AssistantAnswers = Record<string, string>;
