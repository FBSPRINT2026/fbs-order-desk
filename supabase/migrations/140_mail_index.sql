-- Every email's header, all the way back (Oct 13: "Search older mail" asked the mail server live, folder by folder,
-- and found nothing when the server was busy). Filled a few thousand at a time by the slow-lane job; searched instead
-- of the mailbox for anything older than the 45-day cache.
create table if not exists public.mail_index (
  account_id uuid not null,
  folder text not null,
  uidvalidity bigint not null,
  uid bigint not null,
  message_id text not null default '',
  in_reply_to text not null default '',
  subject text not null default '',
  from_email text not null default '',
  from_name text not null default '',
  to_list text[] not null default '{}',
  cc_list text[] not null default '{}',
  to_text text not null default '',
  sent_at timestamptz,
  size integer not null default 0,
  hay text not null default '',
  primary key (account_id, folder, uidvalidity, uid)
);
create index if not exists mail_index_hay on public.mail_index using gin (hay gin_trgm_ops);
create index if not exists mail_index_date on public.mail_index (account_id, sent_at desc);
alter table public.mail_index enable row level security;
create table if not exists public.mail_index_state (
  account_id uuid not null,
  folder text not null,
  uidvalidity bigint not null default 0,
  total integer not null default 0,
  indexed integer not null default 0,
  low_uid bigint,
  high_uid bigint,
  checked_at timestamptz,
  primary key (account_id, folder)
);
alter table public.mail_index_state enable row level security;
