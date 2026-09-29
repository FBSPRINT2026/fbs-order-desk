-- Sales analytics for the dashboard (staff only): Printavo invoices (by order date) + invoices here (by approval date).
create or replace function public.shop_sales_monthly(p_from date)
returns table(month date, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', d)::date, round(sum(t)::numeric, 2), count(*)
  from (
    select a.order_date as d, coalesce(a.total, 0) as t from archived_orders a
      where a.kind = 'invoice' and a.order_date >= p_from and coalesce(a.status_name, '') !~* 'cancel'
    union all
    select coalesce(o.approved_at, o.created_at)::date, coalesce(o.total, 0) from orders o
      where o.type = 'invoice' and coalesce(o.approved_at, o.created_at) >= p_from
  ) x
  where public.is_staff()
  group by 1 order by 1
$$;
create or replace function public.shop_top_customers(p_from date, p_to date, p_limit int default 10)
returns table(customer_id uuid, name text, sales numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select x.customer_id, coalesce(nullif(c.company, ''), c.name, 'Unknown'), round(sum(x.t)::numeric, 2), count(*)
  from (
    select a.customer_id, coalesce(a.total, 0) as t from archived_orders a
      where a.kind = 'invoice' and a.order_date >= p_from and a.order_date < p_to and coalesce(a.status_name, '') !~* 'cancel'
    union all
    select o.customer_id, coalesce(o.total, 0) from orders o
      where o.type = 'invoice' and coalesce(o.approved_at, o.created_at) >= p_from and coalesce(o.approved_at, o.created_at) < p_to
  ) x
  left join customers c on c.id = x.customer_id
  where public.is_staff() and x.customer_id is not null
  group by 1, 2 order by 3 desc limit p_limit
$$;
grant execute on function public.shop_sales_monthly(date) to authenticated;
grant execute on function public.shop_top_customers(date, date, int) to authenticated;
