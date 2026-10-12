-- Email → Inbox summary written ahead of time (Oct 12): one row per mailbox, rewritten by /api/mail/cache when the
-- Inbox changes (at most every 5 minutes), so opening it is instant. Server only.
create table if not exists public.mail_brief (
  account_id uuid primary key references public.mail_accounts(id) on delete cascade,
  sig text not null default '',
  brief jsonb not null,
  at timestamptz not null default now()
);
alter table public.mail_brief enable row level security;
