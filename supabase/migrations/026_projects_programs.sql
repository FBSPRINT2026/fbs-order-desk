-- Projects: a customer's bigger effort (a conference, a season, an event) with several orders,
-- key dates, tasks and its own conversation.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null default '',
  status text not null default 'planning' check (status in ('planning','active','delivered','closed')),
  event_date date,
  in_hands_date date,
  delivery text not null default '',
  requests text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_customer_idx on public.projects (customer_id, event_date);
alter table public.projects enable row level security;
drop policy if exists projects_staff on public.projects;
create policy projects_staff on public.projects for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists projects_customer on public.projects;
create policy projects_customer on public.projects for select using (customer_id in (select public.my_customer_ids()));

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  due_date date,
  who text not null default 'shop' check (who in ('shop','customer')),
  shop_only boolean not null default false,
  done_at timestamptz,
  done_by text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists project_tasks_project_idx on public.project_tasks (project_id, position);
alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_staff on public.project_tasks;
create policy project_tasks_staff on public.project_tasks for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists project_tasks_customer on public.project_tasks;
create policy project_tasks_customer on public.project_tasks for select using (not shop_only and project_id in (select id from public.projects where customer_id in (select public.my_customer_ids())));

alter table public.orders add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists orders_project_idx on public.orders (project_id) where project_id is not null;
alter table public.archived_orders add column if not exists project_id uuid references public.projects(id) on delete set null;
-- a project's conversation (customer_id is set too, so the customer can read it)
alter table public.messages add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- Program pricing: items a customer orders often at a flat price per piece, and a quick order form for them.
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null default 'Program',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists programs_customer_idx on public.programs (customer_id);
alter table public.programs enable row level security;
drop policy if exists programs_staff on public.programs;
create policy programs_staff on public.programs for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists programs_customer on public.programs;
create policy programs_customer on public.programs for select using (active and customer_id in (select public.my_customer_ids()));

create table if not exists public.program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null default '',
  style text not null default '',
  brand text not null default '',
  garment text not null default '',
  colors text[] not null default '{}',
  sizes text[] not null default '{}',
  price numeric not null default 0,
  min_qty integer not null default 0,
  imprints jsonb not null default '[]'::jsonb,
  design_id uuid references public.designs(id) on delete set null,
  image_path text not null default '',
  notes text not null default '',
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists program_items_program_idx on public.program_items (program_id, position);
alter table public.program_items enable row level security;
drop policy if exists program_items_staff on public.program_items;
create policy program_items_staff on public.program_items for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists program_items_customer on public.program_items;
create policy program_items_customer on public.program_items for select using (active and program_id in (select id from public.programs where active and customer_id in (select public.my_customer_ids())));
