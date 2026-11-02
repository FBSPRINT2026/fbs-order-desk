-- Orders deleted in Printavo (Nov 2, Nick: "#34596 for Cedar Promos was deleted in Printavo… but it's still in our system").
-- Kept, never deleted: marked removed_at and left out of every list; cleared again if Printavo shows the order again.
alter table public.archived_orders add column if not exists removed_at timestamptz;
create index if not exists archived_orders_removed on public.archived_orders (removed_at) where removed_at is not null;
-- when Printavo's order list last showed it (the time-frame check re-reads the ones it didn't)
alter table public.printavo_index add column if not exists range_seen_at timestamptz;

-- the ones the sync already found gone
update public.archived_orders a set removed_at = coalesce(i.deep_at, now())
  from public.printavo_index i where i.archived_id = a.id and i.status = 'gone' and a.removed_at is null;

-- sales numbers and staff search leave them out
create or replace function public.sales_lines(p_from date, p_to date default null::date)
 returns table(d date, customer_id uuid, total numeric, archived_id uuid)
 language sql stable security definer set search_path to 'public'
as $function$
  select x.d, x.customer_id, x.total, x.archived_id from (
    select a.order_date as d, a.customer_id, coalesce(a.total, 0)::numeric as total, a.id as archived_id
    from archived_orders a
    where a.kind = 'invoice' and a.order_date is not null and a.removed_at is null
      and coalesce(a.status_name, '') !~* '(cancel|holder|quote\s*-\s*closed|closed\s*quote)'
      and coalesce(a.status_name, '') !~* '^\s*quote\s*$'
    union all
    select coalesce(o.approved_at, o.created_at)::date, o.customer_id, coalesce(o.total, 0)::numeric, null::uuid
    from orders o
    where o.type = 'invoice' and o.status not in ('request', 'quote', 'quote_sent') and coalesce(o.source, '') <> 'sample'
  ) x
  where public.is_staff() and x.d >= p_from and (p_to is null or x.d < p_to)
    and not exists (select 1 from customers c where c.id = x.customer_id and c.is_test)
$function$;

create or replace function public.search_archived_orders(p_q text, p_limit integer default 25)
 returns table(id uuid, visual_id text, nickname text, po_number text, status_name text, due_date date, company text, name text)
 language sql stable security definer set search_path to 'public'
as $function$
  select a.id, a.visual_id, a.nickname, a.po_number, a.status_name, a.due_date, c.company, c.name
  from public.archived_orders a left join public.customers c on c.id = a.customer_id
  where (select public.is_staff()) and length(btrim(p_q)) >= 2 and a.removed_at is null and a.search_staff ilike '%' || lower(btrim(p_q)) || '%'
  order by a.order_date desc nulls last
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$function$;

create or replace function public.search_archived_orders(p_words text[], p_limit integer default 25)
 returns setof archived_orders
 language sql stable security definer set search_path to 'public'
as $function$
  select a.*
  from public.archived_orders a
  where (select public.is_staff())
    and coalesce(array_length(p_words, 1), 0) > 0 and a.removed_at is null
    and a.search_staff ilike '%' || p_words[1] || '%'
    and not exists (select 1 from unnest(p_words[2:]) w where a.search_staff not ilike '%' || w || '%')
  order by a.order_date desc nulls last
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$function$;

do $$
declare def text;
begin
  select pg_get_functiondef('public.shop_sales_by_department(date, date)'::regprocedure) into def;
  if position('a.removed_at is null' in def) = 0 then
    execute replace(def, 'where a.kind = ''invoice'' and a.order_date is not null and a.order_date >= p_from',
                         'where a.kind = ''invoice'' and a.order_date is not null and a.removed_at is null and a.order_date >= p_from');
  end if;
end $$;
