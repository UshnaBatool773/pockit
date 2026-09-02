import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { validateBody, validateParams } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../middleware/errorHandler";
import {
  envelopeAdjustSchema,
  envelopeCreateSchema,
  envelopeUpdateSchema,
  uuidParamSchema,
} from "../utils/schemas";

export const envelopesRouter = Router();

envelopesRouter.use(requireAuth);

// List all envelopes for the current user.
envelopesRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!
      .from("envelopes")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw new ApiError(500, error.message);
    res.json({ envelopes: data });
  })
);

// Create an envelope.
envelopesRouter.post(
  "/",
  validateBody(envelopeCreateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!
      .from("envelopes")
      .insert({ ...req.body, user_id: req.user!.id })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ envelope: data });
  })
);

// Update an envelope (name/budget/color/icon).
envelopesRouter.patch(
  "/:id",
  validateParams(uuidParamSchema),
  validateBody(envelopeUpdateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!
      .from("envelopes")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, "Envelope not found");
    res.json({ envelope: data });
  })
);

// Add or spend money against an envelope atomically via a Postgres RPC
// (defined in sql/schema.sql) so concurrent requests can't race each other.
envelopesRouter.post(
  "/:id/adjust",
  validateParams(uuidParamSchema),
  validateBody(envelopeAdjustSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!.rpc("adjust_envelope_amount", {
      p_envelope_id: req.params.id,
      p_delta: req.body.delta,
    });

    if (error) throw new ApiError(400, error.message);
    res.json({ envelope: data });
  })
);

// Delete an envelope.
envelopesRouter.delete(
  "/:id",
  validateParams(uuidParamSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await req.supabase!.from("envelopes").delete().eq("id", req.params.id);
    if (error) throw new ApiError(500, error.message);
    res.status(204).send();
  })
);
