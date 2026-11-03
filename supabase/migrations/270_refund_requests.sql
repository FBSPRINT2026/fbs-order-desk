-- Credits (Nov 3, Nick): a customer's refund of a credit over $20 waits here for Nick or Amanda to approve (Take a Payment).
create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  amount numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending','done','declined','failed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz, stax_refund_id text, note text, error text
);
alter table public.refund_requests enable row level security;
revoke all on public.refund_requests from anon, authenticated;
