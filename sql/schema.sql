-- ─────────────────────────────────────────────────────────────────────────
-- Envelope app schema for Supabase (Postgres)
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── envelopes ───────────────────────────────────────────────────────────
create table if not exists public.envelopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric(14, 2) not null default 0,
  budget numeric(14, 2) not null default 0,
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists envelopes_user_id_idx on public.envelopes (user_id);

alter table public.envelopes enable row level security;

drop policy if exists "envelopes_select_own" on public.envelopes;
create policy "envelopes_select_own" on public.envelopes
  for select using (auth.uid() = user_id);

drop policy if exists "envelopes_insert_own" on public.envelopes;
create policy "envelopes_insert_own" on public.envelopes
  for insert with check (auth.uid() = user_id);

drop policy if exists "envelopes_update_own" on public.envelopes;
create policy "envelopes_update_own" on public.envelopes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "envelopes_delete_own" on public.envelopes;
create policy "envelopes_delete_own" on public.envelopes
  for delete using (auth.uid() = user_id);

-- ── transactions ────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  name text not null,
  amount numeric(14, 2) not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_envelope_id_idx on public.transactions (envelope_id);

alter table public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

-- ── vault_entries ───────────────────────────────────────────────────────
-- password_encrypted holds ciphertext only (AES-256-GCM, encrypted by the
-- backend using VAULT_ENCRYPTION_KEY). Postgres/Supabase never sees plaintext.
-- `strength` (0-100) is computed by the backend at write time from the
-- plaintext, then stored — it is safe to store since it does not reveal
-- the password itself, only a rough quality score, and lets the UI render
-- the strong/moderate/weak summary without decrypting every entry.
create table if not exists public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  site text not null,
  username text not null,
  category text not null default 'Other',
  password_encrypted text not null,
  strength smallint not null default 0 check (strength between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vault_entries_user_id_idx on public.vault_entries (user_id);

alter table public.vault_entries enable row level security;

drop policy if exists "vault_select_own" on public.vault_entries;
create policy "vault_select_own" on public.vault_entries
  for select using (auth.uid() = user_id);

drop policy if exists "vault_insert_own" on public.vault_entries;
create policy "vault_insert_own" on public.vault_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "vault_update_own" on public.vault_entries;
create policy "vault_update_own" on public.vault_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "vault_delete_own" on public.vault_entries;
create policy "vault_delete_own" on public.vault_entries
  for delete using (auth.uid() = user_id);

-- ── vault_security (PIN lock) ────────────────────────────────────────────
-- A second factor in front of the vault, independent of the Supabase
-- session. Only a bcrypt hash of the PIN is ever stored. failed_attempts
-- and locked_until implement server-side lockout so a 4-6 digit PIN can't
-- just be brute-forced by hammering the verify endpoint (rate limiting
-- alone is not enough protection for a PIN this short).
create table if not exists public.vault_security (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vault_security enable row level security;

drop policy if exists "vault_security_select_own" on public.vault_security;
create policy "vault_security_select_own" on public.vault_security
  for select using (auth.uid() = user_id);

drop policy if exists "vault_security_insert_own" on public.vault_security;
create policy "vault_security_insert_own" on public.vault_security
  for insert with check (auth.uid() = user_id);

drop policy if exists "vault_security_update_own" on public.vault_security;
create policy "vault_security_update_own" on public.vault_security
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "vault_security_delete_own" on public.vault_security;
create policy "vault_security_delete_own" on public.vault_security
  for delete using (auth.uid() = user_id);

-- ── updated_at triggers ─────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists envelopes_set_updated_at on public.envelopes;
create trigger envelopes_set_updated_at
  before update on public.envelopes
  for each row execute function public.set_updated_at();

drop trigger if exists vault_set_updated_at on public.vault_entries;
create trigger vault_set_updated_at
  before update on public.vault_entries
  for each row execute function public.set_updated_at();

drop trigger if exists vault_security_set_updated_at on public.vault_security;
create trigger vault_security_set_updated_at
  before update on public.vault_security
  for each row execute function public.set_updated_at();

-- ── RPC: atomically adjust an envelope's amount ─────────────────────────
-- SECURITY DEFINER is intentionally NOT used: this runs as the calling
-- user (via PostgREST/RPC over the user-scoped client), so RLS still
-- applies and a user can only ever adjust their own envelope.
create or replace function public.adjust_envelope_amount(p_envelope_id uuid, p_delta numeric)
returns public.envelopes
language plpgsql
security invoker
as $$
declare
  v_row public.envelopes;
begin
  update public.envelopes
  set amount = amount + p_delta
  where id = p_envelope_id
    and user_id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Envelope not found or not owned by caller';
  end if;

  return v_row;
end;
$$;

-- ── RPC: create a transaction and adjust its envelope in one statement ──
create or replace function public.create_transaction(
  p_envelope_id uuid,
  p_name text,
  p_amount numeric,
  p_occurred_at timestamptz
)
returns public.transactions
language plpgsql
security invoker
as $$
declare
  v_tx public.transactions;
  v_owner uuid;
begin
  select user_id into v_owner from public.envelopes where id = p_envelope_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Envelope not found or not owned by caller';
  end if;

  insert into public.transactions (user_id, envelope_id, name, amount, occurred_at)
  values (auth.uid(), p_envelope_id, p_name, p_amount, p_occurred_at)
  returning * into v_tx;

  update public.envelopes
  set amount = amount + p_amount
  where id = p_envelope_id;

  return v_tx;
end;
$$;
