import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, "ALLOWED_ORIGINS is required, comma-separated list of allowed frontend origins"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(20, "SUPABASE_ANON_KEY looks too short / missing"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  VAULT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loudly at boot rather than limping along with bad config.
  // We deliberately do NOT print process.env, only the validation issues.
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  ALLOWED_ORIGINS: parsed.data.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === "production",
};
