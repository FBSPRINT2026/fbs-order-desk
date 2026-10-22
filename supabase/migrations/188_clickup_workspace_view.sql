-- ClickUp workspace view (Oct 22, Nick: "click on their workspace and view it kind of like you do in ClickUp… all that's
-- completed, not completed", and "if we mark something complete, it auto-completes" in ClickUp).
alter table public.clickup_tasks add column if not exists list_id text;
alter table public.clickup_teams add column if not exists backfill_page int not null default 0;
alter table public.clickup_teams add column if not exists backfill_done_at timestamptz;
create index if not exists clickup_tasks_team_created on public.clickup_tasks (team_id, created_at_cu desc);
comment on column public.clickup_tasks.list_id is 'The ClickUp list (board) the task is on: its statuses decide Mark complete / Reopen (Oct 22).';
comment on column public.clickup_teams.backfill_page is 'Completed jobs of the last 3 years read in for the workspace view: the next page to read (Oct 22).';
