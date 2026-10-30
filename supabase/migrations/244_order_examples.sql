-- Worked examples for Create order (Oct 30, 2026): an order staff said is right, beside what came in and the first
-- reading, used to read the customer's next order the same way (lib/ai/orderExamples.ts). Additive only.
create table if not exists public.order_examples (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid not null unique references public.orders(id),
  activity_id uuid,
  title text not null default '',
  source_text text not null default '',
  order_text text not null default '',
  reading_text text not null default '',
  confirmed_by text not null default '',
  confirmed_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists order_examples_customer on public.order_examples (customer_id, confirmed_at desc);
alter table public.order_examples enable row level security;
