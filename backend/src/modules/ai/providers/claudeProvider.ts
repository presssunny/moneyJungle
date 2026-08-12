import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { env } from "../../../config/env";
import type { AiProvider, AiRequest, AiResponse } from "../ai.types";

/** The Messages API rejects a request without max_tokens, so the layer always sends one. */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Only the one SDK call this provider makes. Narrowing it to a function keeps
 * the SDK's streaming/non-streaming overloads out of the test seam and lets a
 * test pass a plain fake instead of mocking the module.
 */
export type ClaudeMessagesCreate = (
  body: MessageCreateParamsNonStreaming
) => Promise<Message>;

let client: Anthropic | undefined;

/** Built on first use, not at import, so the app boots with no key configured. */
function realMessagesCreate(body: MessageCreateParamsNonStreaming): Promise<Message> {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set — cannot reach the Claude API");
    }
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client.messages.create(body);
}

export class ClaudeProvider implements AiProvider {
  readonly name = "claude";

  constructor(
    private readonly createMessage: ClaudeMessagesCreate = realMessagesCreate,
    private readonly model: string = env.ANTHROPIC_MODEL
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const response = await this.createMessage(this.toClaudeRequest(request));
    return toAiResponse(response);
  }

  private toClaudeRequest(request: AiRequest): MessageCreateParamsNonStreaming {
    const messages = toClaudeMessages(request.messages);
    if (messages.length === 0) {
      throw new Error("AI request needs at least one user or assistant message");
    }

    const system = collectSystem(request);
    return {
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system ? { system } : {}),
      // Opaque id only — Anthropic's abuse signal, and never PII.
      metadata: { user_id: String(request.userId) },
    };
  }
}

/**
 * One canonical home for the system prompt: the top-level field. Vendors differ
 * on whether a system-role message is accepted at all, so the neutral layer
 * never depends on it. Order is fixed: `request.system`, then system messages.
 */
function collectSystem(request: AiRequest): string {
  const parts = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  if (request.system) parts.unshift(request.system);
  return parts.filter((part) => part.trim() !== "").join("\n\n");
}

function toClaudeMessages(messages: AiRequest["messages"]): MessageParam[] {
  const mapped: MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    mapped.push({ role: message.role, content: message.content });
  }
  return mapped;
}

/** A reply can carry thinking or tool blocks too; only text is part of the contract today. */
function toAiResponse(response: Message): AiResponse {
  const content = response.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
