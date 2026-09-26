import type { AiProvider } from "../ai/ai.types";
import type { QuestionAnswer } from "../../types/householdAssistant.types";
import { businessDate } from "../../utils/date.utils";
import { dashboardRepository } from "../dashboard/dashboard.repository";
import { answerQuestion } from "./answers.service";
import { EXAMPLES, INTENT_CATALOGUE, matchQuestion, routedQuestion, type RoutedQuestion } from "./questions";

export interface AskInput {
  question: string;
  /** Explicit, per question: only then may the question text leave the server. */
  consent: boolean;
  documentId?: number;
}

/**
 * The model only picks an intent from the server's catalogue for the question the
 * household typed. It never sees a figure, a record or a file, and its reply is
 * validated before any service runs. A malformed or out-of-scope choice is
 * treated as no answer rather than guessed at.
 */
async function routeWithModel(userId: number, input: AskInput, provider: AiProvider): Promise<RoutedQuestion | null> {
  const scope = input.documentId ? "document" : "household";
  const catalogue = Object.entries(INTENT_CATALOGUE)
    .filter(([, spec]) => spec.scope === scope)
    .map(([intent, spec]) => `- ${intent}: ${spec.description}${spec.params ? ` (${spec.params})` : ""}`)
    .join("\n");
  try {
    const response = await provider.complete({
      userId, maxTokens: 128, signal: AbortSignal.timeout(15000),
      system: `Route a household-finance question written in Hebrew to one intent. Intents:\n${catalogue}\nReply with JSON only, e.g. {"intent":"month_totals","month":"current"}. If none fits, reply {"intent":null}. Never answer the question, calculate, or add fields.`,
      messages: [{ role: "user", content: input.question }],
    });
    if (response.content.length > 500) return null;
    const parsed = routedQuestion.safeParse(JSON.parse(response.content));
    if (!parsed.success || INTENT_CATALOGUE[parsed.data.intent].scope !== scope) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function askQuestion(userId: number, input: AskInput, provider: AiProvider | null): Promise<QuestionAnswer> {
  const scope = input.documentId ? "document" : "household";
  const categories = scope === "household" ? (await dashboardRepository.categories(userId)).map((c) => c.name) : [];
  const local = matchQuestion(input.question, businessDate(), categories, scope === "document");
  let routed = local;
  let mode: QuestionAnswer["mode"] = "rules";
  if (!routed && input.consent && provider) {
    routed = await routeWithModel(userId, input, provider);
    mode = "ai";
  }
  if (!routed) {
    const reason = !input.consent
      ? "לא זיהיתי את השאלה. אפשר לנסח אחרת, או לאשר שליחה של נוסח השאלה בלבד לעוזר החכם."
      : !provider ? "לא זיהיתי את השאלה, והעוזר החכם אינו מוגדר בשרת." : "לא מצאתי תשובה מבוססת לשאלה הזאת.";
    return { mode: "unanswered", intent: null, answer: reason, facts: [], links: [], limitations: [], examples: EXAMPLES[scope] };
  }
  return { mode, examples: [], ...(await answerQuestion(userId, routed, input.documentId)) };
}
