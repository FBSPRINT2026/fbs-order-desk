-- Email cached mode (Oct 12, Nick: "cache like Outlook… 45 days"): a copy of the last 45 days of each owner's mail
-- (Inbox, Sent, Archive and their own folders; not Junk, Deleted, Drafts, Black Hole or News), so opening, folders and
-- search are instant. Filled and kept current by /api/mail/cache every 2 minutes. Older mail is still read live.
-- Rows for emails moved or deleted in Outlook get gone_at. Server only (RLS on, no policies).
create table if not exists public.mail_cache (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  folder text not null,
  uidvalidity bigint not null,
  uid bigint not null,
  message_id text not null default '',
  in_reply_to text not null default '',
  refs text[] not null default '{}',
  subject text not null default '',
  from_email text not null default '',
  from_name text not null default '',
  to_list text[] not null default '{}',
  cc_list text[] not null default '{}',
  to_text text not null default '',
  cc_text text not null default '',
  reply_to text not null default '',
  sent_at timestamptz,
  seen boolean not null default false,
  flagged boolean not null default false,
  size integer not null default 0,
  body_text text not null default '',
  body_html text,                      -- null when it was too big to keep (opened live then)
  attachments jsonb not null default '[]'::jsonb,
  hay text not null default '',        -- lower-case who + subject + start of the text, for search
  cached_at timestamptz not null default now(),
  gone_at timestamptz
);
create unique index if not exists mail_cache_key on public.mail_cache (account_id, folder, uidvalidity, uid);
create index if not exists mail_cache_folder on public.mail_cache (account_id, folder, sent_at desc) where gone_at is null;
create index if not exists mail_cache_msg on public.mail_cache (account_id, message_id);
create index if not exists mail_cache_hay on public.mail_cache using gin (hay gin_trgm_ops);
alter table public.mail_cache enable row level security;

create table if not exists public.mail_cache_state (
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  folder text not null,
  uidvalidity bigint,
  in_window integer not null default 0,
  cached integer not null default 0,
  checked_at timestamptz,
  primary key (account_id, folder)
);
alter table public.mail_cache_state enable row level security;

create or replace function public.mail_cache_tick() returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare t uuid;
begin
  if not exists (select 1 from mail_accounts where enabled and (last_error_at is null or last_error_at < now() - interval '15 minutes')) then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/mail/cache', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;

select cron.schedule('mail-cache', '1-59/2 * * * *', 'select public.mail_cache_tick()');
