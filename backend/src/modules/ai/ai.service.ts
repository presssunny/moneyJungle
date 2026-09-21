import { env } from "../../config/env";
import type { AiProvider } from "./ai.types";
import { ClaudeProvider } from "./providers/claudeProvider";

export function aiAvailable(): boolean {
  return env.AI_PROVIDER === "claude" && Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * The only place that names a vendor. Callers ask for `getAiProvider()` and get
 * the `AiProvider` contract, so adding a second vendor is one more case below —
 * not an edit at every call site. Importing a provider directly defeats this.
 */
export function getAiProvider(provider: string = env.AI_PROVIDER): AiProvider {
  switch (provider) {
    case "claude":
      return new ClaudeProvider();
    default:
      throw new Error(`Unknown AI_PROVIDER: "${provider}" (supported: claude)`);
  }
}
