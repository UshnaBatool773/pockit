import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { validateBody, validateParams } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../middleware/errorHandler";
import { transactionCreateSchema, uuidParamSchema } from "../utils/schemas";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

// List transactions for the current user, most recent first.
// Optional ?search= does a case-insensitive match on the transaction name,
// to back the search box on the Transactions page.
transactionsRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    let query = req.supabase!
      .from("transactions")
      .select("*, envelopes(name)")
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw new ApiError(500, error.message);
    res.json({ transactions: data });
  })
);

// Monthly spent/saved totals for the dashboard trend chart, computed from
// the last N months of transactions (default 6). "saved" = net positive
// months, "spent" = sum of debits — both derived server-side so the
// frontend never has to pull the full transaction history just to draw a
// small area chart.
transactionsRouter.get(
  "/summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const { data, error } = await req.supabase!
      .from("transactions")
      .select("amount, occurred_at")
      .gte("occurred_at", since.toISOString());

    if (error) throw new ApiError(500, error.message);

    const buckets = new Map<string, { spent: number; saved: number }>();
    for (let i = 0; i < months; i++) {
      const d = new Date(since);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, { spent: 0, saved: 0 });
    }

    for (const row of data ?? []) {
      const d = new Date(row.occurred_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (row.amount < 0) bucket.spent += Math.abs(row.amount);
      else bucket.saved += row.amount;
    }

    const summary = Array.from(buckets.entries()).map(([key, v]) => {
      const [year, month] = key.split("-");
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-US", {
        month: "short",
      });
      return { month: label, spent: Math.round(v.spent), saved: Math.round(v.saved) };
    });

    res.json({ summary });
  })
);

// Create a transaction. This also nudges the related envelope's amount via
// the same RPC used by the manual adjust endpoint, kept in one DB
// transaction on the Postgres side for consistency.
transactionsRouter.post(
  "/",
  validateBody(transactionCreateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await req.supabase!.rpc("create_transaction", {
      p_envelope_id: req.body.envelope_id,
      p_name: req.body.name,
      p_amount: req.body.amount,
      p_occurred_at: req.body.occurred_at ?? new Date().toISOString(),
    });

    if (error) throw new ApiError(400, error.message);
    res.status(201).json({ transaction: data });
  })
);

transactionsRouter.delete(
  "/:id",
  validateParams(uuidParamSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await req.supabase!.from("transactions").delete().eq("id", req.params.id);
    if (error) throw new ApiError(500, error.message);
    res.status(204).send();
  })
);
