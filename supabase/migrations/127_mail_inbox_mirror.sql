-- Each connected person's Outlook Inbox, mirrored: one row per email sitting in their Inbox right now (from/subject
-- only for non-customer mail; customer email is linked to its activities row). Archived or moved out in Outlook =
-- gone_at set; Archive in the portal moves it in Outlook too. Server only (RLS on, no policies).
create table if not exists public.mail_inbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  uid bigint not null,
  uidvalidity bigint not null,
  message_id text not null default '',
  from_email text not null default '',
  from_name text not null default '',
  subject text not null default '',
  received_at timestamptz,
  cc_only boolean not null default false,
  unread boolean not null default false,
  flagged boolean not null default false,
  activity_id uuid references public.activities(id) on delete set null,
  first_seen timestamptz not null default now(),
  gone_at timestamptz,
  done_by text
);
create unique index if not exists mail_inbox_uid on public.mail_inbox (account_id, uidvalidity, uid);
create index if not exists mail_inbox_open on public.mail_inbox (account_id) where gone_at is null;
create index if not exists mail_inbox_msg on public.mail_inbox (account_id, message_id);
alter table public.mail_inbox enable row level security;
