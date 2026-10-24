-- Printavo invoices we show as still owing: the sync re-reads these once a day (Oct 24: a paid Printavo invoice older
-- than 30 days kept showing its old balance in the portal). Read-only view, runs with the caller's rights.
create or replace view public.printavo_open_invoices with (security_invoker = true) as
  select i.printavo_id, i.deep_at, i.imported_at, a.id as archived_id, a.balance
  from public.printavo_index i
  join public.archived_orders a on a.id = i.archived_id
  where a.kind = 'invoice' and a.balance > 0.004 and i.status in ('done', 'files');
revoke all on public.printavo_open_invoices from anon, authenticated;
