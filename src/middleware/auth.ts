import { NextFunction, Request, Response } from "express";
import { anonClient, getUserScopedClient } from "../config/supabase";

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string };
  accessToken?: string;
  supabase?: ReturnType<typeof getUserScopedClient>;
}

/**
 * Expects `Authorization: Bearer <supabase-access-token>`.
 * The token is whatever supabase-auth-js on the frontend gives you after
 * sign in (session.access_token) — this backend never issues its own JWTs
 * and never sees a password.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or malformed Authorization header" });
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    // Ask Supabase to validate the token and return the associated user.
    // This calls out to Supabase's auth server and also checks expiry/signature.
    const { data, error } = await anonClient.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.user = { id: data.user.id, email: data.user.email ?? undefined };
    req.accessToken = token;
    // Per-request client scoped to this user's token, so all DB access
    // downstream is subject to Postgres RLS as this specific user.
    req.supabase = getUserScopedClient(token);

    next();
  } catch (err) {
    next(err);
  }
}
