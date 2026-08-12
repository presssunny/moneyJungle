import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it } from "vitest";
import { getAiProvider } from "./ai.service";
import type { AiRequest } from "./ai.types";
import { ClaudeProvider } from "./providers/claudeProvider";

/**
 * A reply built by hand rather than fetched. No test in this file may reach the
 * network — the SDK call is injected, so a missing API key is irrelevant here.
 */
function replyWith(content: Message["content"]): Message {
  return {
    id: "msg_test",
    container: null,
    content,
    model: "claude-sonnet-5",
    role: "assistant",
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 11,
      output_tokens: 7,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

function textReply(text: string): Message {
  return replyWith([{ type: "text", text, citations: null }]);
}

/** Captures the body the provider would have sent, and answers with `reply`. */
function spyProvider(reply: Message = textReply("ok")) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const provider = new ClaudeProvider(async (body) => {
    sent.push(body);
    return reply;
  });
  return { provider, sent };
}

const baseRequest: AiRequest = {
  userId: 1,
  messages: [{ role: "user", content: "כמה הוצאתי החודש?" }],
};

describe("getAiProvider — the single vendor-selection point", () => {
  it("returns the Claude provider for the default configuration", () => {
    expect(getAiProvider("claude").name).toBe("claude");
  });

  it("returns a provider satisfying the AiProvider contract", () => {
    expect(typeof getAiProvider("claude").complete).toBe("function");
  });

  it("fails loudly on an unknown provider rather than silently defaulting", () => {
    // A typo in AI_PROVIDER must not quietly route to Claude and bill the wrong vendor.
    expect(() => getAiProvider("gpt-9")).toThrow(/Unknown AI_PROVIDER/);
  });

  it("defaults to the configured provider when called with no argument", () => {
    expect(getAiProvider().name).toBe("claude");
  });
});

describe("ClaudeProvider — mapping the neutral request onto the SDK", () => {
  it("sends the user message and always sets max_tokens", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete(baseRequest);

    expect(sent).toHaveLength(1);
    expect(sent[0].messages).toEqual([{ role: "user", content: "כמה הוצאתי החודש?" }]);
    // Omitting max_tokens makes the API reject the call outright.
    expect(sent[0].max_tokens).toBeGreaterThan(0);
  });

  it("honours an explicit maxTokens", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete({ ...baseRequest, maxTokens: 128 });
    expect(sent[0].max_tokens).toBe(128);
  });

  it("passes userId through as an opaque metadata id", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete({ ...baseRequest, userId: 42 });
    expect(sent[0].metadata?.user_id).toBe("42");
  });

  it("hoists system-role messages out of the array into the system field", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete({
      userId: 1,
      system: "You are a finance assistant.",
      messages: [
        { role: "system", content: "Answer in Hebrew." },
        { role: "user", content: "שלום" },
      ],
    });

    // request.system leads, then any system-role messages in order.
    expect(sent[0].system).toBe("You are a finance assistant.\n\nAnswer in Hebrew.");
    expect(sent[0].messages).toEqual([{ role: "user", content: "שלום" }]);
  });

  it("omits system entirely when none was given", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete(baseRequest);
    expect(sent[0].system).toBeUndefined();
  });

  it("keeps a multi-turn conversation in order", async () => {
    const { provider, sent } = spyProvider();
    await provider.complete({
      userId: 1,
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });
    expect(sent[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("returns the text of the reply and maps usage to camelCase", async () => {
    const { provider } = spyProvider(textReply("הוצאת 1,200 ש\"ח"));
    const response = await provider.complete(baseRequest);

    expect(response.content).toBe("הוצאת 1,200 ש\"ח");
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it("joins several text blocks and ignores non-text blocks", async () => {
    // A thinking or tool block must not crash the mapping or leak into content.
    const { provider } = spyProvider(
      replyWith([
        { type: "text", text: "one ", citations: null },
        { type: "thinking", thinking: "hidden reasoning", signature: "sig" },
        { type: "text", text: "two", citations: null },
      ])
    );

    const response = await provider.complete(baseRequest);
    expect(response.content).toBe("one two");
  });

  /** A non-text block with a `.text`-shaped field is what actually exercises the type filter. */
  it("never leaks a non-text block's own data into content", async () => {
    const rogueBlock = { type: "tool_use", text: "LEAKED" } as unknown as Message["content"][number];
    const { provider } = spyProvider(
      replyWith([{ type: "text", text: "one ", citations: null }, rogueBlock, { type: "text", text: "two", citations: null }])
    );

    const response = await provider.complete(baseRequest);
    expect(response.content).toBe("one two");
    expect(response.content).not.toContain("LEAKED");
  });

  it("rejects a request with no addressable message instead of calling the API", async () => {
    const { provider, sent } = spyProvider();
    await expect(
      provider.complete({ userId: 1, messages: [{ role: "system", content: "only system" }] })
    ).rejects.toThrow(/at least one user or assistant message/);
    expect(sent).toHaveLength(0);
  });
});
