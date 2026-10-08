-- Connected services (Dropbox for the film folder, Oct 8, 2026). Run once in Supabase → SQL editor.
-- Holds the service's long-lived sign-in (a refresh token) for the server only: row security is on and there are
-- no policies, so no signed-in user can read it; only the server (service role) can.
create table if not exists public.integration_tokens (
  name text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.integration_tokens enable row level security;

-- the customer's folder in the Dropbox film folder (e.g. "/FBS Film Folder/Peticolas"): set on the customer page;
-- when blank it's found by the customer's name
alter table public.customers add column if not exists film_folder text;
