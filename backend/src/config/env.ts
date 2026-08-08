import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Login identity. Read only by modules/gate/credentials.ts — never anywhere else.
  APP_GATE_USERNAME: z.string().min(1).default("admin"),
  APP_GATE_PASSWORD: z.string().min(1, "APP_GATE_PASSWORD is required"),
  GATE_SESSION_DAYS: z.coerce.number().default(30),
  // Comma-separated allow-list of browser origins. Empty → allow all (dev only).
  CORS_ORIGIN: z.string().default(""),
  // Which AI vendor to talk to. Read only by modules/ai/ai.service.ts.
  // Kept a plain string, not an enum, so an unknown value fails loudly in that
  // one switch instead of killing app boot for every other feature.
  AI_PROVIDER: z.string().default("claude"),
  // Read only by modules/ai/providers/claudeProvider.ts — never anywhere else.
  // Optional on purpose: the app must boot without a key, so a missing key
  // surfaces when an AI call is made rather than taking the server down.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  // Read only by modules/documents/documentStorage.service.ts. Relative paths
  // resolve under backend/ so the value stays portable across machines.
  DOCUMENT_STORAGE_DIR: z.string().default("storage/documents"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
