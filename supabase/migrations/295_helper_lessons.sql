-- The Order helper teaches the AI (Nov 6, Nick: "this is a trainer… if we do Tiger Blue 10 orders in a row and nothing
-- changes… hey, I think I've discovered a pattern… would you like me to try to make the next order with these rules?").
-- One row per order made with the Order helper: what staff said each file was (lib/helperLearn.ts).
create table if not exists public.helper_lessons (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid,
  activity_id uuid,
  files jsonb not null default '[]'::jsonb,
  in_message boolean not null default false,
  note text,
  matched boolean,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists helper_lessons_cust on public.helper_lessons (customer_id, created_at desc);
alter table public.helper_lessons enable row level security;
create policy helper_lessons_staff on public.helper_lessons for select using (is_staff());
