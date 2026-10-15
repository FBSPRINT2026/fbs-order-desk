-- a design's emails found by searching the whole mailbox (every year, through Exchange's own search), kept so the
-- design history and the spec history don't search the mailbox again every time (lib/designMail.ts)
create table if not exists design_mail_cache (
  key text primary key,
  emails jsonb not null default '[]'::jsonb,
  searched_at timestamptz not null default now()
);
alter table design_mail_cache enable row level security;
