import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { validateBody, validateParams } from "../middleware/validate";
import { vaultLimiter } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../middleware/errorHandler";
import { decryptSecret, encryptSecret } from "../utils/encryption";
import { estimatePasswordStrength } from "../utils/passwordStrength";
import {
  uuidParamSchema,
  vaultCreateSchema,
  vaultPinSetSchema,
  vaultPinVerifySchema,
  vaultUpdateSchema,
} from "../utils/schemas";

export const vaultRouter = Router();

vaultRouter.use(requireAuth, vaultLimiter);

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// A short PIN needs much stricter throttling than the rest of the API,
// since 4 digits is only 10,000 combinations. This caps verify attempts
// tightly even before the per-account lockout counter kicks in.
const pinVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many PIN attempts, please wait before trying again." },
});

// ── PIN status: does this user have a vault PIN configured? ─────────────
vaultRouter.get(
  "/pin/status",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!
      .from("vault_security")
      .select("user_id, locked_until")
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);

    res.json({
      configured: Boolean(data),
      locked: Boolean(data?.locked_until && new Date(data.locked_until) > new Date()),
    });
  })
);

// ── Set or change the vault PIN ──────────────────────────────────────────
vaultRouter.post(
  "/pin",
  validateBody(vaultPinSetSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { pin, currentPin } = req.body;

    const { data: existing, error: fetchErr } = await req.supabase!
      .from("vault_security")
      .select("pin_hash")
      .maybeSingle();

    if (fetchErr) throw new ApiError(500, fetchErr.message);

    if (existing) {
      if (!currentPin) {
        throw new ApiError(400, "currentPin is required to change an existing PIN");
      }
      const matches = await bcrypt.compare(currentPin, existing.pin_hash);
      if (!matches) {
        throw new ApiError(401, "Current PIN is incorrect");
      }
    }

    const pin_hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    const { error } = await req.supabase!.from("vault_security").upsert(
      {
        user_id: req.user!.id,
        pin_hash,
        failed_attempts: 0,
        locked_until: null,
      },
      { onConflict: "user_id" }
    );

    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true });
  })
);

// ── Verify the vault PIN to unlock ───────────────────────────────────────
vaultRouter.post(
  "/pin/verify",
  pinVerifyLimiter,
  validateBody(vaultPinVerifySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data: security, error } = await req.supabase!
      .from("vault_security")
      .select("pin_hash, failed_attempts, locked_until")
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!security) throw new ApiError(404, "No vault PIN has been set yet");

    if (security.locked_until && new Date(security.locked_until) > new Date()) {
      throw new ApiError(423, `Vault is locked. Try again after ${security.locked_until}`);
    }

    const matches = await bcrypt.compare(req.body.pin, security.pin_hash);

    if (!matches) {
      const attempts = (security.failed_attempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

      await req.supabase!
        .from("vault_security")
        .update({
          failed_attempts: shouldLock ? 0 : attempts,
          locked_until: shouldLock
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
            : null,
        })
        .eq("user_id", req.user!.id);

      if (shouldLock) {
        throw new ApiError(423, `Too many incorrect attempts. Vault locked for ${LOCKOUT_MINUTES} minutes.`);
      }
      throw new ApiError(401, `Incorrect PIN (${MAX_FAILED_ATTEMPTS - attempts} attempts remaining)`);
    }

    // Reset counters on success.
    await req.supabase!
      .from("vault_security")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("user_id", req.user!.id);

    res.json({ ok: true });
  })
);

// List vault entries. Passwords are decrypted only here, in-memory, per
// request, for the authenticated owner, and never logged. The frontend
// should gate access to this page behind a successful /pin/verify call,
// but note that is a UX gate, not the security boundary — the real
// boundary is the Supabase JWT + RLS, same as every other route.
vaultRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!
      .from("vault_entries")
      .select("id, site, username, category, password_encrypted, strength, created_at")
      .order("created_at", { ascending: true });

    if (error) throw new ApiError(500, error.message);

    const entries = (data ?? []).map((row) => ({
      id: row.id,
      site: row.site,
      username: row.username,
      category: row.category,
      strength: row.strength,
      password: decryptSecret(row.password_encrypted),
      created_at: row.created_at,
    }));

    res.json({ entries });
  })
);

vaultRouter.post(
  "/",
  validateBody(vaultCreateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { site, username, password, category } = req.body;
    const strength = estimatePasswordStrength(password);

    const { data, error } = await req.supabase!
      .from("vault_entries")
      .insert({
        site,
        username,
        category,
        password_encrypted: encryptSecret(password),
        strength,
        user_id: req.user!.id,
      })
      .select("id, site, username, category, strength, created_at")
      .single();

    if (error) throw new ApiError(500, error.message);
    // Echo back the plaintext password once, so the UI can show it
    // immediately without a second round trip — never store it in the response cache.
    res.status(201).json({ entry: { ...data, password } });
  })
);

vaultRouter.patch(
  "/:id",
  validateParams(uuidParamSchema),
  validateBody(vaultUpdateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const update: Record<string, unknown> = { ...req.body };
    if (typeof req.body.password === "string") {
      update.password_encrypted = encryptSecret(req.body.password);
      update.strength = estimatePasswordStrength(req.body.password);
      delete update.password;
    }

    const { data, error } = await req.supabase!
      .from("vault_entries")
      .update(update)
      .eq("id", req.params.id)
      .select("id, site, username, category, strength, created_at")
      .single();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, "Vault entry not found");
    res.json({ entry: data });
  })
);

vaultRouter.delete(
  "/:id",
  validateParams(uuidParamSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await req.supabase!.from("vault_entries").delete().eq("id", req.params.id);
    if (error) throw new ApiError(500, error.message);
    res.status(204).send();
  })
);
