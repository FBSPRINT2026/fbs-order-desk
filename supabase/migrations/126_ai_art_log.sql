-- AI Design in the Design Lab (Oct 11): each call to the art service (Recraft, about $0.08 an image) is logged, so a
-- person can only make so many a day (the bill can't run away) and the shop can see what's used.
create table if not exists public.ai_art_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  is_staff boolean not null default false,
  prompt text not null default '',
  style text not null default '',
  images int not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ai_art_log_user_day on public.ai_art_log (user_id, created_at desc);
alter table public.ai_art_log enable row level security;
