-- ClickUp priority flags (Oct 22, Nick: "how are we handling like the urgent flags or priority flags on all the
-- customers?"): kept with each job, Urgent / High flagged and listed first.
alter table public.clickup_tasks add column if not exists priority text not null default '';
comment on column public.clickup_tasks.priority is 'ClickUp priority: urgent | high | normal | low | empty. Urgent and High are flagged and listed first (Oct 22).';
