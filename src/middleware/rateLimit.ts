import rateLimit from "express-rate-limit";

// General API traffic
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// Tighter limit for the vault routes, since they touch the most sensitive data
// and are the most attractive target for brute-force / scraping.
export const vaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many vault requests, please slow down." },
});
