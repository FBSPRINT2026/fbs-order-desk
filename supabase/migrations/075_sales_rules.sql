-- What counts as a sale (one place, used by every sales number on the dashboard):
--   Printavo: invoices only, and not closed quotes ("Quote - Closed"), plain quotes, holders ("Holder Waiting on
--   Details") or cancelled jobs. "Quote - Paid" is a paid job, so it counts.
--   This system: invoices past the quote stage (not requests / quotes), not sample jobs.
-- Staff only (owners / admins see the dashboard).
create or replace function public.sales_lines(p_from date, p_to date default null)
returns table(d date, customer_id uuid, total numeric, archived_id uuid)
language sql stable security definer set search_path = public as $$
  select x.d, x.customer_id, x.total, x.archived_id from (
    select a.order_date as d, a.customer_id, coalesce(a.total, 0)::numeric as total, a.id as archived_id
    from archived_orders a
    where a.kind = 'invoice' and a.order_date is not null
      and coalesce(a.status_name, '') !~* '(cancel|holder|quote\s*-\s*closed|closed\s*quote)'
      and coalesce(a.status_name, '') !~* '^\s*quote\s*$'
    union all
    select coalesce(o.approved_at, o.created_at)::date, o.customer_id, coalesce(o.total, 0)::numeric, null::uuid
    from orders o
    where o.type = 'invoice' and o.status not in ('request', 'quote', 'quote_sent') and coalesce(o.source, '') <> 'sample'
  ) x
  where public.is_staff() and x.d >= p_from and (p_to is null or x.d < p_to)
$$;

create or replace function public.shop_sales_monthly(p_from date)
returns table(month date, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', d)::date, round(sum(total), 2), count(*) from public.sales_lines(p_from) group by 1 order by 1
$$;

create or replace function public.shop_top_customers(p_from date, p_to date, p_limit integer default 10)
returns table(customer_id uuid, name text, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select x.customer_id, coalesce(nullif(c.company, ''), c.name, 'Unknown'), round(sum(x.total), 2), count(*)
  from public.sales_lines(p_from, p_to) x left join customers c on c.id = x.customer_id
  where x.customer_id is not null
  group by 1, 2 order by 3 desc limit p_limit
$$;

-- day by day (for the weekly bars and the year-to-date pace line)
create or replace function public.shop_sales_daily(p_from date)
returns table(day date, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select d, round(sum(total), 2), count(*) from public.sales_lines(p_from) group by 1 order by 1
$$;

-- by account owner (the customer's owner here, else the owner on the Printavo order)
create or replace function public.shop_sales_by_owner(p_from date, p_to date)
returns table(owner text, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(split_part(coalesce(nullif(cp.account_owner, ''), nullif(a.data->>'owner', '')), ' ', 1), 'Unassigned'), round(sum(x.total), 2), count(*)
  from public.sales_lines(p_from, p_to) x
  left join customer_private cp on cp.customer_id = x.customer_id
  left join archived_orders a on a.id = x.archived_id
  group by 1 order by 2 desc
$$;
