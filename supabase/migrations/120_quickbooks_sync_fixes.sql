-- QuickBooks sync fixes from the review (Oct 9, 2026). Additive only; applied live.

-- when live sending was switched on (orders numbered below live_from made after this need a person), and the company
-- QuickBooks was connected to before (a reconnect to a different company turns the sync off and warns)
alter table public.qbo_settings add column if not exists live_since timestamptz;
alter table public.qbo_settings add column if not exists previous_realm_id text not null default '';
alter table public.qbo_settings add column if not exists realm_warning text;
alter table public.qbo_settings add column if not exists lock_id uuid;

-- our customer's values when the link was made (or last sent): only fields changed here after linking are pushed;
-- the rest show under "Differences between ours and QuickBooks" for the owner to opt in
alter table public.qbo_links add column if not exists ours_base jsonb;

-- the next order number, without using one up (switching to live refuses while it's below live_from_number)
create or replace function public.qbo_next_order_number() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(last_value + increment_by, start_value) from pg_sequences where schemaname = 'public' and sequencename = 'order_number_seq'
$$;
revoke execute on function public.qbo_next_order_number() from public, anon, authenticated;

-- the runner's lock, owned: claim returns an id, only that id can extend or release it
create or replace function public.qbo_lock_claim(p_seconds integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid(); got uuid;
begin
  update qbo_settings set lock_until = now() + make_interval(secs => p_seconds), lock_id = v
  where id = 1 and (lock_until is null or lock_until < now()) returning lock_id into got;
  return got;
end $$;
create or replace function public.qbo_lock_extend(p_id uuid, p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update qbo_settings set lock_until = now() + make_interval(secs => p_seconds) where id = 1 and lock_id = p_id returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.qbo_lock_release(p_id uuid) returns void
language sql security definer set search_path = public as $$ update qbo_settings set lock_until = null, lock_id = null where id = 1 and lock_id = p_id $$;
revoke execute on function public.qbo_lock_claim(integer) from public, anon, authenticated;
revoke execute on function public.qbo_lock_extend(uuid, integer) from public, anon, authenticated;
revoke execute on function public.qbo_lock_release(uuid) from public, anon, authenticated;

-- token refresh across server instances: one refresher at a time (a short lease), and the new tokens are saved only
-- if the refresh token is still the one that was used (compare-and-swap), so a rotated token is never overwritten
create or replace function public.qbo_token_lease(p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update integration_tokens set data = data || jsonb_build_object('refresh_lease_until', now() + make_interval(secs => p_seconds))
  where name = 'quickbooks' and coalesce((data->>'refresh_lease_until')::timestamptz, 'epoch'::timestamptz) < now() returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.qbo_token_swap(p_old_refresh text, p_new jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update integration_tokens set data = (p_new - 'refresh_lease_until'), updated_at = now(), updated_by = 'refresh'
  where name = 'quickbooks' and data->>'refresh_token' = p_old_refresh returning true into ok;
  return coalesce(ok, false);
end $$;
revoke execute on function public.qbo_token_lease(integer) from public, anon, authenticated;
revoke execute on function public.qbo_token_swap(text, jsonb) from public, anon, authenticated;
