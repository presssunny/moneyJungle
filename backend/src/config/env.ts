import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_GATE_PASSWORD: z.string().min(1, "APP_GATE_PASSWORD is required"),
  GATE_SESSION_DAYS: z.coerce.number().default(30),
  // Comma-separated allow-list of browser origins. Empty → allow all (dev only).
  CORS_ORIGIN: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
