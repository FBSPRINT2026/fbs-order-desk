-- the public website's "Tell us what you need" form (app/site): numbers an order made by the server (no signed-in user)
create or replace function public.order_commit_server(p_id uuid) returns integer language plpgsql security definer set search_path to 'public' as $$
declare o record; n integer;
begin
  select id, number, draft into o from orders where id = p_id;
  if not found then raise exception 'Order not found.'; end if;
  if not o.draft then return o.number; end if;
  n := nextval('order_number_seq');
  update orders set draft = false, discarded_at = null, number = n, created_at = now() where id = p_id;
  return n;
end $$;
revoke all on function public.order_commit_server(uuid) from public, anon, authenticated;
grant execute on function public.order_commit_server(uuid) to service_role;
-- each website request (and blocked spam), for a per-address limit
create table if not exists public.site_requests (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  email text, ip text, order_id uuid references orders(id), customer_id uuid, spam boolean not null default false, detail jsonb
);
alter table public.site_requests enable row level security;
create policy site_requests_staff on public.site_requests for select using (is_staff());
create index if not exists site_requests_ip_at on public.site_requests (ip, created_at);
-- the public website's photos (lib/siteContent.ts sitePhoto)
insert into storage.buckets (id, name, public) values ('site','site', true) on conflict (id) do nothing;
