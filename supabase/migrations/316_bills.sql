-- Send a bill (Nick, Nov 16 2026: "when we finalize an invoice… send them a bill… individual bills or grouped… not
-- everybody's going into the portal every day"). Each bill sent: who, which invoices, to whom, and its one reminder
-- (7 days on, only for the invoices still unpaid then). components/tools/SendBillTool.tsx, lib/bills.ts.
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_ids uuid[] not null,
  total numeric not null default 0,
  sent_to text[] not null default '{}',
  note text not null default '',
  sent_by text not null default '',
  sent_at timestamptz not null default now(),
  remind_at timestamptz,
  reminded_at timestamptz
);
create index if not exists bills_customer on public.bills (customer_id, sent_at desc);
create index if not exists bills_remind on public.bills (remind_at) where reminded_at is null;
alter table public.bills enable row level security;
drop policy if exists bills_staff on public.bills;
create policy bills_staff on public.bills for all using ((select public.is_staff())) with check ((select public.is_staff()));
