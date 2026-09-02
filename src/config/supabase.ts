import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * SECURITY NOTE
 * -------------
 * We deliberately do NOT create a single global client authenticated with
 * the service_role key for regular data access. Instead, every authenticated
 * request gets its own Supabase client scoped to that user's access token.
 *
 * This means Postgres Row Level Security (RLS) policies — not just our
 * Express code — are the ultimate gatekeeper for who can read/write which
 * rows. Even if there were a bug in our authorization logic, a user
 * physically cannot query another user's rows, because the database itself
 * enforces `auth.uid() = user_id` on every query.
 *
 * The service_role key (if ever needed for a true admin task) bypasses RLS
 * entirely, so it is not used here and should be treated as extremely
 * sensitive if you ever add it.
 */
export function getUserScopedClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Unauthenticated client, used only to verify tokens (auth.getUser) during
 * the auth middleware step, before we know who the caller is.
 */
export const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
