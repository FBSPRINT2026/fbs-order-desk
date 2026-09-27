alter table public.designs add column if not exists designer jsonb;
comment on column public.designs.designer is 'Editable layers when the logo was made in the shirt designer (text, clip art, images), so it can be reopened and changed.';
