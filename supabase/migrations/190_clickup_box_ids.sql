-- Tick ClickUp check boxes from the portal (Oct 22, Nick: "can we check like in Printavo here? And it'll check in
-- ClickUp"): each task's check box fields by name, so the workspace view can set them.
alter table public.clickup_tasks add column if not exists field_ids jsonb not null default '{}'::jsonb;
comment on column public.clickup_tasks.field_ids is 'The task''s ClickUp check box fields by name -> field id ({ "In Printavo": "<id>" }), so a box ticked in the workspace view is ticked in ClickUp (Oct 22).';
