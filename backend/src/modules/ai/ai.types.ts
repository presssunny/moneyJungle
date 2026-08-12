/**
 * The vendor-neutral vocabulary of the AI layer. Nothing here may mention
 * Anthropic, a model id, or an SDK shape — swapping vendors must be a new file
 * under providers/, not an edit to this one.
 */

export type AiRole = "user" | "assistant" | "system";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiRequest {
  /**
   * Who the call is for. Explicit per request rather than ambient state, so
   * per-user scoping and permissions can be added later without reshaping this
   * layer or its callers.
   */
  userId: number;
  messages: AiMessage[];
  /** Prepended to any `system`-role messages the provider hoists out. */
  system?: string;
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResponse {
  content: string;
  usage?: AiUsage;
}

/**
 * Every vendor is reached through this one method. Tool-calling and streaming
 * are deliberately absent — they arrive with the AI Orchestrator, and guessing
 * their shape now would bake today's vendor into the contract.
 */
export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}
