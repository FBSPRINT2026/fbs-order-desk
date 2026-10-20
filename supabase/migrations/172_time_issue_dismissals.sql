-- Time clock issues someone marked as fine (Oct 20, 2026): "No lunch taken" on a day flagged for a missing lunch.
-- Keyed like "lunch:<employee id>:<day>". Missed punches can't be dismissed, only fixed.
create table if not exists public.time_issue_dismissals (
  key text primary key,
  dismissed_by text not null default '',
  dismissed_at timestamptz not null default now()
);
alter table public.time_issue_dismissals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'time_issue_dismissals' and policyname = 'time_issue_dismissals_staff') then
    create policy time_issue_dismissals_staff on public.time_issue_dismissals for all using (public.is_staff()) with check (public.is_staff());
  end if;
end $$;
