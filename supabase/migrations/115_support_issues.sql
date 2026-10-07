-- Support: "Report an issue" in the shop menu (Nick, Oct 7, 2026). Anyone on staff sends what went wrong (dictated or
-- typed) with a screenshot of the page; the owner sees them all on the Support page and works through them with Claude.
create table if not exists public.support_issues (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  by text not null default lower(public.auth_email()),
  page text,               -- the page's address when it was reported
  page_title text,
  message text not null default '',
  screenshot text,         -- path in the "proofs" bucket
  context jsonb not null default '{}'::jsonb,  -- browser, screen size, role, viewing-as
  status text not null default 'open' check (status in ('open', 'working', 'fixed', 'wont')),
  notes text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists support_issues_created on public.support_issues (created_at desc);
alter table public.support_issues enable row level security;

-- staff report (as themselves) and see their own; the owner sees and updates everything
drop policy if exists support_insert on public.support_issues;
create policy support_insert on public.support_issues for insert with check (public.is_staff() and lower(by) = lower(public.auth_email()));
drop policy if exists support_read on public.support_issues;
create policy support_read on public.support_issues for select using (public.staff_role() = 'owner' or lower(by) = lower(public.auth_email()));
drop policy if exists support_update on public.support_issues;
create policy support_update on public.support_issues for update using (public.staff_role() = 'owner');
