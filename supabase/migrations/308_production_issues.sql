-- Issue on a run (Nick, Nov 12 2026: "missing goods or rejects. Or reprint"): pieces of an order that still have to
-- print after its run, marked from the schedule's right-click (after the fact too). Each is its own job card on the
-- schedule ("#40478 Missing · 10 pcs"); Missing waits in Ready To Schedule until the goods are counted in.
create table if not exists production_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  -- the kind of machine the run was on (screen / embroidery / heat), and its print spots (null = all of them)
  kind text not null,
  locations text[],
  why text not null check (why in ('missing', 'reject', 'reprint')),
  -- pieces still to print, by size ({"M": 4, "L": 6}); pcs is their total
  sizes jsonb not null default '{}'::jsonb,
  pcs integer not null check (pcs > 0),
  from_slot uuid references production_slots(id) on delete set null,
  at timestamptz not null default now(),
  by text,
  -- Missing: when the goods came in (a count saved after the issue, or "Goods are here")
  goods_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'canceled')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists production_issues_order on production_issues(order_id) where status = 'open';
alter table production_issues enable row level security;
drop policy if exists production_issues_staff on production_issues;
create policy production_issues_staff on production_issues for all using ((select is_staff())) with check ((select is_staff()));

-- a booking of an issue's pieces
alter table production_slots add column if not exists issue_id uuid references production_issues(id) on delete cascade;
