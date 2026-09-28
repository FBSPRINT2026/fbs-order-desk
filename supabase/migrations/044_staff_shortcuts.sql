-- Each admin's own quick links under "My shortcuts" in the left menu: [{ label, href }]
alter table public.staff add column if not exists shortcuts jsonb not null default '[]'::jsonb;
