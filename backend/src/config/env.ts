import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Pre-multi-user shared login identity. No longer read by the running app
  // (modules/gate/credentials.ts now checks per-account email/passwordHash in
  // the DB) — kept optional, not removed, because
  // prisma/scripts/backfillMultiUserAuth.ts reads these to give the ONE
  // pre-existing account (created before this change) real login credentials
  // that match what its owner already knows, instead of a guessed value.
  APP_GATE_USERNAME: z.string().optional(),
  APP_GATE_PASSWORD: z.string().optional(),
  GATE_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  PUBLIC_ORIGIN: z.string().default(""),
  TRUST_PROXY: z.string().default("false"),
  HOST: z.string().default("127.0.0.1"),
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
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production") {
    try {
      const url = new URL(value.PUBLIC_ORIGIN);
      if (url.protocol !== "https:" || url.origin !== value.PUBLIC_ORIGIN) throw new Error();
    } catch { ctx.addIssue({ code: "custom", path: ["PUBLIC_ORIGIN"], message: "Production requires an exact HTTPS origin" }); }
  }
  if (!["false", "loopback"].includes(value.TRUST_PROXY)) {
    ctx.addIssue({ code: "custom", path: ["TRUST_PROXY"], message: "Use false for direct access or loopback for the local reverse proxy" });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
