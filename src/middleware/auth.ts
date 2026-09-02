import { NextFunction, Request, Response } from "express";
import { anonClient, getUserScopedClient } from "../config/supabase";

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string };
  accessToken?: string;
  supabase?: ReturnType<typeof getUserScopedClient>;
}

/**
 * Expects `Authorization: Bearer <supabase-access-token>`.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({
        error: "Missing or malformed Authorization header",
      });
      return;
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
      res.status(401).json({
        error: "Missing bearer token",
      });
      return;
    }

    const { data, error } = await anonClient.auth.getUser(token);

    if (error || !data?.user) {
      res.status(401).json({
        error: "Invalid or expired session",
      });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? undefined,
    };

    req.accessToken = token;

    req.supabase = getUserScopedClient(token);

    next();
  } catch (err) {
    next(err);
  }
}