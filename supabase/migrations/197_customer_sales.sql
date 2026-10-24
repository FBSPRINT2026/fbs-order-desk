-- My Day favorites (Oct 24): this year's sales, order count and last order date for a few customers at once.
-- Staff only (the same sales rule as the sales charts: public.sales_lines).
create or replace function public.shop_customer_sales(p_ids uuid[], p_from date, p_to date default null)
returns table(customer_id uuid, sales numeric, orders bigint, last_order date)
language sql stable security definer set search_path to 'public' as $$
  select x.customer_id, round(sum(x.total), 2), count(*), max(x.d)
  from public.sales_lines(p_from, p_to) x
  where public.is_staff() and x.customer_id = any(p_ids)
  group by 1
$$;
revoke all on function public.shop_customer_sales(uuid[], date, date) from public, anon;
grant execute on function public.shop_customer_sales(uuid[], date, date) to authenticated;
