-- One mailbox per staff member (each connects their own in the Inbox), instead of one shop mailbox in Vercel.
-- The password is stored encrypted (AES-GCM, key derived on the server), and the table has NO client access:
-- the portal reads it only on the server. Read state (last UID per folder) is per mailbox.
create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text not null unique,
  name text not null default '',
  imap_host text not null default 'east.exch021.serverdata.net',
  smtp_host text not null default 'east.exch021.serverdata.net',
  enc_password text not null,
  enabled boolean not null default true,
  inbox_validity bigint, inbox_uid bigint,
  sent_folder text, sent_validity bigint, sent_uid bigint,
  running_until timestamptz,
  last_run_at timestamptz, last_ok_at timestamptz, last_error text, last_error_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mail_accounts enable row level security;
-- (no policies: only the server's service role can read or write it)

create or replace function public.mail_account_claim(p_id uuid, p_seconds int) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update mail_accounts set running_until = now() + make_interval(secs => p_seconds)
   where id = p_id and (running_until is null or running_until < now());
  return found;
end $$;
revoke all on function public.mail_account_claim(uuid, int) from public, anon, authenticated;

-- the schedule calls the server only while some mailbox is connected (and not in its 15-minute wait after an error)
create or replace function public.mail_sync_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  if not exists (select 1 from mail_accounts where enabled and (last_error_at is null or last_error_at < now() - interval '15 minutes')) then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/mail/sync', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
revoke all on function public.mail_sync_tick() from public, anon, authenticated;
