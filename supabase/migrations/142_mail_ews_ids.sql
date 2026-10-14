-- Email over EWS (Oct 14): the page addresses an email by folder + number (as IMAP did); an email listed over EWS gets
-- a number here (from 1,000,000,000,000 up, so it never collides with an IMAP number) that stands for its EWS id.
create table if not exists public.mail_ews_ids (
  id bigint generated always as identity (start with 1000000000000) primary key,
  account_id uuid not null,
  item_id text not null,
  folder text not null default '',
  created_at timestamptz not null default now(),
  unique (account_id, item_id)
);
alter table public.mail_ews_ids enable row level security;
