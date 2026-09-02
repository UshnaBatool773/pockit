import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.isProd ? "info" : "debug",
  redact: {
    // Never let secrets, tokens, or vault contents end up in logs.
    paths: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.username",
      "*.password",
      "*.accessToken",
      "*.access_token",
      "*.SUPABASE_SERVICE_ROLE_KEY",
      "*.VAULT_ENCRYPTION_KEY",
    ],
    censor: "[REDACTED]",
  },
});
