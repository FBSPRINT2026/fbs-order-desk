-- ClickUp Jobs (Oct 22, Nick: "customers go in there and upload jobs for us… each customer has their own board… a
-- clickup tool. When you click the clickup tool, it would basically show you, hey, McKenna uploaded… would you like to
-- process this order? …let's create a new order or let's create a reorder. And then you go through the same process…
-- at the end you would go back and click the In Printavo button in ClickUp").
-- Phenomenal, Nine18, Cedar Promos (Peter Sleiman), Logotology, TCA, Cowboy Cool, Tigerblue and The McKenna Group each
-- have a ClickUp workspace ("Space / Purchase Orders"), a task per job: the PO / art attached, notes, a due date,
-- fields ("In Printavo", "PO Ready") and comments. lib/clickup.ts reads them (CLICKUP_API_TOKEN in Vercel); the only
-- thing ever written to ClickUp is ticking the task's "In Printavo" box once its order is made. Additive only.

-- each ClickUp workspace and the customer it belongs to
create table if not exists public.clickup_teams (
  id text primary key,                         -- ClickUp workspace (team) id
  name text not null default '',
  members jsonb not null default '[]'::jsonb,  -- [email] of the people in it who aren't us
  customer_id uuid references public.customers(id) on delete set null,
  guessed boolean not null default false,      -- the portal picked the customer; staff haven't confirmed it
  hidden boolean not null default false,       -- not a customer's jobs (staff hid it)
  seen_at timestamptz not null default now()
);
alter table public.clickup_teams enable row level security;
create policy clickup_teams_staff on public.clickup_teams for all using ((select is_staff())) with check ((select is_staff()));

-- each task (job)
create table if not exists public.clickup_tasks (
  id text primary key,                         -- ClickUp task id
  team_id text not null,
  where_text text not null default '',         -- "Space › Purchase Orders"
  name text not null default '',
  url text not null default '',
  parent text,                                 -- a subtask's task
  status text not null default '',
  status_type text not null default '',        -- open | custom | done | closed
  status_color text not null default '',
  due_at timestamptz,
  created_at_cu timestamptz,
  updated_at_cu timestamptz,
  creator_name text not null default '',
  creator_email text not null default '',
  description text not null default '',
  fields jsonb not null default '{}'::jsonb,   -- { "PO Ready": "✓", "Customer Name": "Stephanie Foster" }
  printavo_field text,                         -- the id of its "In Printavo" check box (ticked when the order is made)
  in_printavo boolean not null default false,
  attachments jsonb not null default '[]'::jsonb, -- [{ id, name, url, size, ext, type }]
  comments jsonb not null default '[]'::jsonb,    -- [{ who, email, at, text }] oldest first
  activity_id uuid,                            -- read into the portal (like an email) to make the order
  order_id uuid references public.orders(id) on delete set null,
  order_number int,
  ticked_at timestamptz,                       -- "In Printavo" ticked by the portal
  tick_error text,
  dismissed_at timestamptz,
  dismissed_by text,
  waiting boolean not null default false,      -- a job to process: open, not In Printavo, no order, not dismissed
  synced_at timestamptz not null default now()
);
create index if not exists clickup_tasks_team on public.clickup_tasks (team_id);
create index if not exists clickup_tasks_waiting on public.clickup_tasks (waiting) where waiting;
alter table public.clickup_tasks enable row level security;
create policy clickup_tasks_staff on public.clickup_tasks for all using ((select is_staff())) with check ((select is_staff()));

-- the sync
create table if not exists public.clickup_state (
  id int primary key default 1 check (id = 1),
  setup_at timestamptz,                        -- the first run
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  user_email text,                             -- whose token
  cursors jsonb not null default '{}'::jsonb,  -- { <team id>: <newest date_updated read, ms> }
  stats jsonb not null default '{}'::jsonb
);
insert into public.clickup_state (id) values (1) on conflict do nothing;
alter table public.clickup_state enable row level security;
create policy clickup_state_staff on public.clickup_state for all using ((select is_staff())) with check ((select is_staff()));

-- every 3 minutes (with the sync token, like the mail cache); the route does nothing until the token is in Vercel
create or replace function public.clickup_tick() returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare t uuid;
begin
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/clickup/sync', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
select cron.schedule('clickup-tick', '1-58/3 * * * *', 'select public.clickup_tick()');
