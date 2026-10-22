-- A ClickUp job already in Printavo (Oct 22, Nick: "we have the Printavo number already in there, so I'm not sure why
-- that one's under new"): the Printavo job matched by the numbers in its name is kept, and it isn't a new job.
alter table public.clickup_tasks add column if not exists pv_id uuid;
alter table public.clickup_tasks add column if not exists pv_number text;
comment on column public.clickup_tasks.pv_number is 'The Printavo job this ClickUp job was matched to by the numbers in its name (archived_orders.visual_id): already entered, so not a new job (Oct 22).';
