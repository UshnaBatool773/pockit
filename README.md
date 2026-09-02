# Envelope Backend

A secure Express + TypeScript API for the Envelope budgeting/vault app. Authentication is handled entirely by **Supabase Auth**; this backend verifies Supabase-issued JWTs and enforces per-user data isolation with Postgres **Row Level Security (RLS)**, plus application-level AES-256-GCM encryption for the password vault.

## Architecture at a glance

```
Frontend (React)  --sign up / sign in-->  Supabase Auth
       |                                        |
       | Authorization: Bearer <access_token>   |
       v                                        |
  This backend  ------verifies token------------+
       |
       | queries scoped to the caller's JWT (RLS enforced in Postgres)
       v
  Supabase Postgres (envelopes, transactions, vault_entries)
```

**Nothing about passwords or sessions is handled by this backend.** The frontend talks to Supabase directly (via `@supabase/supabase-js`) for sign up, sign in, sign out, and session refresh, using your `SUPABASE_URL` + anon key. The backend only ever sees the resulting `access_token` on the `Authorization` header and uses it to authorize data requests.

## Security features

- **JWT verification on every request** (`src/middleware/auth.ts`) — invalid/expired tokens are rejected before touching the database.
- **Row Level Security in Postgres** (`sql/schema.sql`) — every table has `auth.uid() = user_id` policies, and the backend queries the database *as the calling user* (not with an all-powerful service key), so even a bug in the API code can't leak another user's rows.
- **Vault encryption at rest** — vault passwords are encrypted with AES-256-GCM using `VAULT_ENCRYPTION_KEY` before they're ever written to the database, on top of RLS. A database export or leaked read-only credential still can't reveal plaintext passwords.
- **Server-verified vault PIN** — the vault's PIN lock (`/api/vault/pin/*`) is enforced in the database, not just as a client-side `useState`. PINs are hashed with bcrypt (never stored in plain text), verification is aggressively rate-limited (10 attempts / 10 min), and the account auto-locks for 15 minutes after 5 wrong attempts in a row.
- **Strict CORS allowlist** — only origins listed in `ALLOWED_ORIGINS` can call the API.
- **Helmet security headers**, **HPP protection** (parameter pollution), and a **100kb request body limit** to blunt payload-based DoS.
- **Rate limiting** — general limiter on `/api/*`, a tighter limiter on `/api/vault/*`.
- **Zod validation** on every request body/param — malformed input is rejected with a 400 before it reaches any handler.
- **Fail-fast config** — the server refuses to boot if required env vars are missing or malformed (`src/config/env.ts`), instead of running with silently broken security settings.
- **Redacted logging** — tokens, passwords, and secret keys are stripped from logs, never printed as-is.
- **No secrets in the repo** — everything sensitive comes from environment variables (`.env` is gitignored; `.env.example` documents what's needed with no real values).

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. In **Project Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
3. In the **SQL Editor**, paste and run the contents of [`sql/schema.sql`](./sql/schema.sql). This creates the tables, enables RLS, and adds the policies/RPC functions the API relies on.
4. (Optional but recommended) In **Authentication → Providers**, enable email confirmations, and in **Authentication → URL Configuration**, set your frontend's URL as a redirect URL.

## 2. Generate your own secrets (don't reuse examples!)

Generate a fresh vault encryption key locally — never share or commit it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

```
PORT=8080
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=<your anon key>
VAULT_ENCRYPTION_KEY=<the 64-hex-char key you just generated>
```

**Never commit `.env`.** It's already in `.gitignore`.

## 3. Run locally

```bash
npm install
npm run dev
```

Server starts on `http://localhost:8080`. Check `GET /health` for a quick sanity check.

## 4. Deploy to Render

### Option A — Blueprint (recommended)

1. Push this `backend/` folder to a GitHub repo.
2. In Render, choose **New → Blueprint**, point it at the repo — it will read `render.yaml` and create the web service automatically.
3. Render will prompt you for the env vars marked `sync: false` in `render.yaml`: `ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAULT_ENCRYPTION_KEY`. Paste the real values there — **only in the Render dashboard, never in code**.

### Option B — Manual web service

1. Render → **New → Web Service** → connect your repo, root directory = `backend`.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Add the same 4 environment variables above under **Environment**.
5. Set **Health Check Path** to `/health`.

Once deployed, set `ALLOWED_ORIGINS` to your actual deployed frontend URL(s) (comma-separated if more than one, e.g. your Vercel preview + production URLs).

## 5. Wire up the frontend

Install the Supabase client in the frontend project:

```bash
npm install @supabase/supabase-js
```

```ts
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Sign up / sign in directly against Supabase:

```ts
await supabase.auth.signUp({ email, password });
await supabase.auth.signInWithPassword({ email, password });
const { data: { session } } = await supabase.auth.getSession();
```

Call this backend with the session token:

```ts
const res = await fetch(`${import.meta.env.VITE_API_URL}/api/envelopes`, {
  headers: { Authorization: `Bearer ${session.access_token}` },
});
```

Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL` (your Render service URL) to the frontend's own env config/host (e.g. Vercel/Netlify env vars) — same rule applies: never hardcode them in source.

## API reference

All routes below require `Authorization: Bearer <supabase access token>` and are prefixed with `/api`.

| Method | Path | Description |
|---|---|---|
| GET | `/envelopes` | List the caller's envelopes |
| POST | `/envelopes` | Create an envelope |
| PATCH | `/envelopes/:id` | Update name/budget/color/icon |
| POST | `/envelopes/:id/adjust` | Add/spend money (`{ "delta": number }`) |
| DELETE | `/envelopes/:id` | Delete an envelope |
| GET | `/transactions?limit=50&search=` | List recent transactions, optional name search |
| GET | `/transactions/summary?months=6` | Monthly spent/saved totals for the trend chart |
| POST | `/transactions` | Create a transaction (also adjusts the envelope) |
| DELETE | `/transactions/:id` | Delete a transaction |
| GET | `/vault` | List vault entries (decrypted), with `category` and `strength` |
| POST | `/vault` | Add a vault entry (`{ site, username, password, category }`) |
| PATCH | `/vault/:id` | Update a vault entry |
| DELETE | `/vault/:id` | Delete a vault entry |
| GET | `/vault/pin/status` | Whether a vault PIN is set / currently locked out |
| POST | `/vault/pin` | Set or change the vault PIN (`{ pin, currentPin? }`) |
| POST | `/vault/pin/verify` | Verify the PIN to unlock the vault (`{ pin }`) |

`GET /health` is unauthenticated, for Render's health checks.

## Wiring up the vault PIN lock

The frontend's "Unlock Vault" screen should call the real backend instead of just flipping local state:

```ts
// On first visit to Vault, check whether a PIN exists yet:
const status = await fetch(`${API_URL}/api/vault/pin/status`, { headers: authHeader }).then(r => r.json());
if (!status.configured) {
  // show a "create a PIN" flow instead of "enter your PIN"
}

// Unlocking:
const res = await fetch(`${API_URL}/api/vault/pin/verify`, {
  method: "POST",
  headers: { ...authHeader, "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
if (res.ok) {
  // only now fetch and render GET /api/vault
} else {
  const { error } = await res.json();
  // show error, e.g. "Incorrect PIN (3 attempts remaining)" or a 423 lockout message
}
```

Treat a successful `/pin/verify` as gating when you *fetch and render* `GET /api/vault` in the UI — the PIN is a UX/privacy-screen layer on top of an already-authenticated session, while the Supabase JWT + RLS remain the actual security boundary underneath it.

## Going further (zero-knowledge vault)

Right now vault passwords are encrypted **server-side** with a key only the backend holds — strong protection against database leaks, but the server technically *could* decrypt vault data since it holds the key. For a true zero-knowledge design (server can never read plaintext, even if compromised), encrypt/decrypt vault entries **client-side** in the browser using a key derived from the user's master password (e.g. via WebCrypto + PBKDF2/Argon2), and only ever send ciphertext to this API. That's a meaningful frontend change, so it's left as a documented next step rather than assumed here — happy to build that version if you want it.
