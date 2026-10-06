-- Nicholas's mailbox (Intermedia hosted Exchange, IMAP/SMTP): every 2 minutes the portal reads new mail in the Inbox
-- and Sent Items. Customer email goes on the customer timeline (activities) and the Assistant drafts replies / quotes;
-- everything else is skipped and not stored. Credentials live only in Vercel (MAIL_PASSWORD, set by Nicholas).
create table if not exists public.mail_sync (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  mailbox text not null default '',
  inbox_validity bigint, inbox_uid bigint,
  sent_folder text, sent_validity bigint, sent_uid bigint,
  running_until timestamptz,
  last_run_at timestamptz, last_ok_at timestamptz, last_error text, last_error_at timestamptz,
  stats jsonb not null default '{}'::jsonb
);
insert into public.mail_sync (id) values (1) on conflict do nothing;
alter table public.mail_sync enable row level security;
create policy mail_sync_staff_read on public.mail_sync for select using (public.is_staff());
create policy mail_sync_staff_write on public.mail_sync for update using (public.is_staff()) with check (public.is_staff());

-- senders staff have sorted by hand: "not a customer" (ignore from now on) or "this is <customer>"
create table if not exists public.mail_senders (
  email text primary key,
  kind text not null check (kind in ('ignore', 'customer')),
  customer_id uuid references public.customers(id),
  decided_by text not null default '',
  decided_at timestamptz not null default now()
);
alter table public.mail_senders enable row level security;
create policy mail_senders_staff on public.mail_senders for all using (public.is_staff()) with check (public.is_staff());

create index if not exists activities_external_idx on public.activities (external_id);

create or replace function public.mail_sync_claim(p_seconds int) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update mail_sync set running_until = now() + make_interval(secs => p_seconds)
   where id = 1 and (running_until is null or running_until < now());
  return found;
end $$;
revoke all on function public.mail_sync_claim(int) from public, anon, authenticated;

create or replace function public.mail_sync_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare s record; t uuid;
begin
  select * into s from mail_sync where id = 1;
  if not s.enabled then return; end if;
  -- after a failed run (wrong password, server down), wait 15 minutes before trying again
  if s.last_error_at is not null and s.last_error_at > now() - interval '15 minutes' then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/mail/sync', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
revoke all on function public.mail_sync_tick() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'mail-sync';
select cron.schedule('mail-sync', '*/2 * * * *', $$select public.mail_sync_tick()$$);
