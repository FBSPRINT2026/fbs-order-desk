-- QuickBooks Online sync (Oct 9, 2026). Takes over from Printavo's QuickBooks integration at the Nov 1-2 cutover.
-- Additive only. Everything here is server-only: row security is on and there are no policies, so no signed-in user
-- can read or write these tables; the shop's server code (service role) does, after checking the viewer is the owner.
--
--   qbo_settings         one row: on/off, preview or live, number ranges, the item / account / payment method maps
--   qbo_links            our record <-> the QuickBooks record, by QuickBooks' own Id (never by name)
--   qbo_queue            the outbox: every change to a customer, order or payment waits here to be sent
--   qbo_log              each request to QuickBooks (a summary: never a token)
--   qbo_match_proposals  the customer matching run's proposals, reviewed by the owner before anything is linked
--   qbo_changes          what QuickBooks told us changed (webhook / change-data-capture), to flag edits made there
-- The sign-in itself (realm, access and refresh tokens) is in integration_tokens, name 'quickbooks' (migration 116).

create table if not exists public.qbo_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  mode text not null default 'preview' check (mode in ('preview', 'live')),
  live_from_number integer not null default 50000,
  adopt_from_number integer not null default 40000,
  token uuid not null default gen_random_uuid(),
  realm_id text not null default '',
  company_name text not null default '',
  item_map jsonb not null default '{}'::jsonb,
  deposit_account_id text not null default '',
  payment_method_map jsonb not null default '{}'::jsonb,
  tax_mode text not null default 'qbo_ast' check (tax_mode in ('qbo_ast', 'tax_line', 'none')),
  tax_code_id text not null default '',
  exemption_reason_id text not null default '',
  term_map jsonb not null default '{}'::jsonb,
  default_term_id text not null default '',
  discount_account_id text not null default '',
  po_field_id text not null default '',
  po_field_name text not null default '',
  class_id text not null default '',
  department_id text not null default '',
  lock_until timestamptz,
  cdc_at timestamptz,
  keepalive_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  matched_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
insert into public.qbo_settings (id) values (1) on conflict (id) do nothing;
alter table public.qbo_settings enable row level security;

create table if not exists public.qbo_links (
  id bigserial primary key,
  realm_id text not null,
  entity text not null,
  local_id text not null,
  qbo_id text not null,
  sync_token text,
  is_primary boolean not null default true,
  source text not null default 'manual',
  confidence numeric,
  last_pushed_hash text,
  last_pushed_at timestamptz,
  last_sent jsonb,
  last_seen_qbo jsonb,
  last_seen_at timestamptz,
  qbo_owned_fields text[] not null default '{}',
  changed_in_qbo jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default ''
);
create unique index if not exists qbo_links_qbo_uq on public.qbo_links (realm_id, entity, qbo_id);
create index if not exists qbo_links_local_idx on public.qbo_links (entity, local_id);
-- exactly one primary QuickBooks record per local record per company (merged Printavo customers keep the others linked)
create unique index if not exists qbo_links_primary_uq on public.qbo_links (realm_id, entity, local_id) where is_primary;
alter table public.qbo_links enable row level security;

create table if not exists public.qbo_queue (
  id bigserial primary key,
  entity text not null check (entity in ('customer', 'invoice', 'payment')),
  local_id text not null,
  op text not null default 'upsert' check (op in ('upsert', 'void', 'delete')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error', 'needs_review', 'skipped')),
  reason text not null default '',
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  payload_preview jsonb,
  previewed_at timestamptz,
  result jsonb,
  resolution jsonb,
  request_key uuid not null default gen_random_uuid(),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one open row per record: a new change to something already waiting just wakes the waiting row up
create unique index if not exists qbo_queue_open_uq on public.qbo_queue (entity, local_id) where status in ('pending', 'error', 'needs_review');
create index if not exists qbo_queue_next_idx on public.qbo_queue (status, run_after) where status in ('pending', 'error');
create index if not exists qbo_queue_status_idx on public.qbo_queue (status, updated_at desc);
alter table public.qbo_queue enable row level security;

create table if not exists public.qbo_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  method text not null default '',
  path text not null default '',
  entity text,
  local_id text,
  qbo_id text,
  queue_id bigint,
  ok boolean not null default false,
  status integer,
  ms integer,
  error text,
  intuit_tid text
);
create index if not exists qbo_log_at_idx on public.qbo_log (at desc);
alter table public.qbo_log enable row level security;

create table if not exists public.qbo_match_proposals (
  id bigserial primary key,
  run_at timestamptz not null,
  realm_id text not null,
  qbo_id text not null,
  qbo_name text not null default '',
  qbo_active boolean not null default true,
  local_id uuid,
  local_name text not null default '',
  method text not null default '',
  confidence numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  is_primary boolean not null default false,
  last_invoice_date date,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected', 'unmatched', 'stale')),
  decided_by text not null default '',
  decided_at timestamptz
);
create index if not exists qbo_match_run_idx on public.qbo_match_proposals (realm_id, run_at desc);
alter table public.qbo_match_proposals enable row level security;

create table if not exists public.qbo_changes (
  id bigserial primary key,
  at timestamptz not null default now(),
  realm_id text not null default '',
  entity text not null,
  qbo_id text not null,
  operation text not null default '',
  last_updated timestamptz,
  source text not null default 'webhook',
  handled_at timestamptz,
  note text not null default ''
);
create index if not exists qbo_changes_open_idx on public.qbo_changes (at) where handled_at is null;
alter table public.qbo_changes enable row level security;

/* ---------- the outbox: database triggers put every change in the queue, so no code path can miss one ---------- */

create or replace function public.qbo_enqueue(p_entity text, p_local_id text, p_op text default 'upsert', p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into qbo_queue (entity, local_id, op, reason) values (p_entity, p_local_id, p_op, p_reason)
  on conflict (entity, local_id) where status in ('pending', 'error', 'needs_review')
  do update set
    op = case when excluded.op <> 'upsert' then excluded.op else qbo_queue.op end,
    status = 'pending', attempts = 0, run_after = now(), reason = excluded.reason, updated_at = now();
end $$;
revoke execute on function public.qbo_enqueue(text, text, text, text) from public, anon, authenticated;

create or replace function public.qbo_customers_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if coalesce(new.is_test, false) then return new; end if;
    perform qbo_enqueue('customer', new.id::text, 'upsert', lower(tg_op));
  exception when others then raise warning 'qbo_customers_trg: %', sqlerrm;
  end;
  return new;
end $$;

create or replace function public.qbo_orders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare from_n integer;
begin
  begin
    select adopt_from_number into from_n from qbo_settings where id = 1;
    from_n := coalesce(from_n, 40000);
    if tg_op = 'DELETE' then
      if old.number >= from_n then perform qbo_enqueue('invoice', old.id::text, 'void', 'deleted'); end if;
      return old;
    end if;
    if new.number >= from_n then perform qbo_enqueue('invoice', new.id::text, 'upsert', lower(tg_op)); end if;
  exception when others then raise warning 'qbo_orders_trg: %', sqlerrm;
  end;
  return new;
end $$;

create or replace function public.qbo_payments_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'DELETE' then perform qbo_enqueue('payment', old.id::text, 'delete', 'deleted'); return old; end if;
    perform qbo_enqueue('payment', new.id::text, 'upsert', lower(tg_op));
  exception when others then raise warning 'qbo_payments_trg: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_customers_ins' and not tgisinternal) then
  create trigger qbo_customers_ins after insert on public.customers for each row execute function public.qbo_customers_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_customers_upd' and not tgisinternal) then
  create trigger qbo_customers_upd after update of company, name, email, phone, address, ship_address, tax_exempt, payment_terms on public.customers
  for each row when (old.company is distinct from new.company or old.name is distinct from new.name or old.email is distinct from new.email
    or old.phone is distinct from new.phone or old.address is distinct from new.address or old.ship_address is distinct from new.ship_address
    or old.tax_exempt is distinct from new.tax_exempt or old.payment_terms is distinct from new.payment_terms)
  execute function public.qbo_customers_trg();
end if; end $t$;

do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_orders_ins' and not tgisinternal) then
  create trigger qbo_orders_ins after insert on public.orders for each row execute function public.qbo_orders_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_orders_upd' and not tgisinternal) then
  create trigger qbo_orders_upd after update of status, groups, lines, fees, discount_pct, discount_amt, discount_type, tax_rate, tax_exempt, waive_setup, price_type, total, customer_id, po_number, due_date, number on public.orders
  for each row when (old.status is distinct from new.status or old.groups is distinct from new.groups or old.lines is distinct from new.lines
    or old.fees is distinct from new.fees or old.discount_pct is distinct from new.discount_pct or old.discount_amt is distinct from new.discount_amt
    or old.discount_type is distinct from new.discount_type or old.tax_rate is distinct from new.tax_rate or old.tax_exempt is distinct from new.tax_exempt
    or old.waive_setup is distinct from new.waive_setup or old.price_type is distinct from new.price_type or old.total is distinct from new.total
    or old.customer_id is distinct from new.customer_id or old.po_number is distinct from new.po_number or old.due_date is distinct from new.due_date
    or old.number is distinct from new.number)
  execute function public.qbo_orders_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_orders_del' and not tgisinternal) then
  create trigger qbo_orders_del after delete on public.orders for each row execute function public.qbo_orders_trg();
end if; end $t$;

do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_payments_ins' and not tgisinternal) then
  create trigger qbo_payments_ins after insert on public.payments for each row execute function public.qbo_payments_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_payments_upd' and not tgisinternal) then
  create trigger qbo_payments_upd after update on public.payments
  for each row when (old.amount is distinct from new.amount or old.method is distinct from new.method or old.paid_on is distinct from new.paid_on
    or old.order_id is distinct from new.order_id or old.processor_id is distinct from new.processor_id or old.note is distinct from new.note)
  execute function public.qbo_payments_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'qbo_payments_del' and not tgisinternal) then
  create trigger qbo_payments_del after delete on public.payments for each row execute function public.qbo_payments_trg();
end if; end $t$;

/* ---------- the runner: one at a time (a lock on the settings row), called every minute by pg_cron ---------- */

create or replace function public.qbo_claim(p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update qbo_settings set lock_until = now() + make_interval(secs => p_seconds)
  where id = 1 and (lock_until is null or lock_until < now()) returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.qbo_release() returns void
language sql security definer set search_path = public as $$ update qbo_settings set lock_until = null where id = 1 $$;
revoke execute on function public.qbo_claim(integer) from public, anon, authenticated;
revoke execute on function public.qbo_release() from public, anon, authenticated;

-- Every minute: calls the runner only when the sync is on. Off but connected: about once a day (keepalive_at) it still
-- calls, so the QuickBooks sign-in is refreshed and doesn't lapse (refresh tokens last 100 days) before the cutover.
create or replace function public.qbo_sync_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s record; connected boolean;
begin
  select enabled, token, keepalive_at into s from qbo_settings where id = 1;
  if s is null then return; end if;
  if not s.enabled then
    select coalesce((data->>'realm_id') <> '', false) into connected from integration_tokens where name = 'quickbooks';
    if not coalesce(connected, false) or (s.keepalive_at is not null and s.keepalive_at > now() - interval '20 hours') then return; end if;
  end if;
  perform net.http_get(
    url := 'https://portal.fbsprint.com/api/qbo/sync',
    headers := jsonb_build_object('x-sync-token', s.token::text),
    timeout_milliseconds := 300000);
end $$;
revoke execute on function public.qbo_sync_tick() from public, anon, authenticated;

-- Queue everything that should be in QuickBooks (after matching, before going live): orders from adopt_from_number
-- up, their customers and their payments. Already-waiting rows are just woken up.
create or replace function public.qbo_enqueue_all() returns integer
language plpgsql security definer set search_path = public as $$
declare from_n integer; n integer := 0; r record;
begin
  select adopt_from_number into from_n from qbo_settings where id = 1;
  from_n := coalesce(from_n, 40000);
  for r in select distinct o.customer_id from orders o join customers c on c.id = o.customer_id where o.number >= from_n and not coalesce(c.is_test, false) loop
    perform qbo_enqueue('customer', r.customer_id::text, 'upsert', 'queue all'); n := n + 1;
  end loop;
  for r in select id from orders where number >= from_n loop
    perform qbo_enqueue('invoice', r.id::text, 'upsert', 'queue all'); n := n + 1;
  end loop;
  for r in select p.id from payments p join orders o on o.id = p.order_id where o.number >= from_n loop
    perform qbo_enqueue('payment', r.id::text, 'upsert', 'queue all'); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.qbo_enqueue_all() from public, anon, authenticated;
