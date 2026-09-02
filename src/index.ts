import express from "express";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/rateLimit";

const app = express();

// Render (and most PaaS) sit behind a proxy; needed for correct client IPs
// in rate limiting and secure cookies/redirects if ever added.
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // this is a pure JSON API, no HTML is served
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

// ── CORS: only allow the configured frontend origin(s) ──────────────────
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (no Origin header) and configured origins only.
      if (!origin || env.ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Body parsing with a sane size limit (defends against payload-bomb DoS)
app.use(express.json({ limit: "100kb" }));

// ── Prevent HTTP parameter pollution ─────────────────────────────────────
app.use(hpp());

// ── Structured request logging (secrets redacted, see utils/logger.ts) ──
app.use(pinoHttp({ logger }));

// ── Rate limiting on all API routes ─────────────────────────────────────
app.use("/api", generalLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`🚀 Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});
