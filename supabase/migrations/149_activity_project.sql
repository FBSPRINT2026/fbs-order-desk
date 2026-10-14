-- An email saved to a customer's project (Oct 14, Nick: the email toolbar's Messages section, "save communication to
-- a project, order, or add to order notes"). Shown on the project page (shop only).
alter table public.activities add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists activities_project_idx on public.activities(project_id) where project_id is not null;
