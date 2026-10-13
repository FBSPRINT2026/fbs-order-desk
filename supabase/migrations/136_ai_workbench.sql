-- AI Workbench (Oct 13, Nick: "just an AI tool … where you can knock stuff out"): each person's chats with the AI —
-- what they asked, the files they dropped in, what it answered and the cards it made (a quote to create, mockups).
-- Server only (the page reads and writes through server code, as the signed-in staff member).
create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  title text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_chats_owner_idx on public.ai_chats (owner, updated_at desc);
alter table public.ai_chats enable row level security;
