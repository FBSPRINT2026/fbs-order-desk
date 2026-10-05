-- "Make Separations Better": the production manager talks to the Separation Studio about how a separation came out
-- (on screen or on press). Nothing is ever deleted: a lesson that's wrong is turned off (active = false). Every exchange is kept (sep_feedback) so the separation engine can be improved from it,
-- and what's worth remembering becomes a lesson (sep_lessons) that the coach and new separations use for 30 days.
create table if not exists public.sep_feedback (
  id uuid primary key default gen_random_uuid(),
  separation_id uuid references public.separations(id) on delete set null,
  design_id uuid,
  by text not null default '',
  message text not null,
  reply text not null default '',
  changes jsonb not null default '[]',
  applied boolean not null default false,
  lesson_id uuid,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists sep_feedback_sep on public.sep_feedback (separation_id, created_at);
create index if not exists sep_feedback_at on public.sep_feedback (created_at desc);

create table if not exists public.sep_lessons (
  id uuid primary key default gen_random_uuid(),
  lesson text not null,
  tags text[] not null default '{}',
  -- an optional starting setting for new separations, e.g. {"setting":"pressGain","value":0.2,"when":"sim"}
  default_setting jsonb,
  by text not null default '',
  feedback_id uuid references public.sep_feedback(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists sep_lessons_live on public.sep_lessons (active, expires_at);

alter table public.sep_feedback enable row level security;
drop policy if exists sep_feedback_staff on public.sep_feedback;
create policy sep_feedback_staff on public.sep_feedback for select using (public.is_staff());
drop policy if exists sep_feedback_add on public.sep_feedback;
create policy sep_feedback_add on public.sep_feedback for insert with check (public.is_staff());
drop policy if exists sep_feedback_edit on public.sep_feedback;
create policy sep_feedback_edit on public.sep_feedback for update using (public.is_staff()) with check (public.is_staff());
alter table public.sep_lessons enable row level security;
drop policy if exists sep_lessons_staff on public.sep_lessons;
create policy sep_lessons_staff on public.sep_lessons for select using (public.is_staff());
drop policy if exists sep_lessons_add on public.sep_lessons;
create policy sep_lessons_add on public.sep_lessons for insert with check (public.is_staff());
drop policy if exists sep_lessons_edit on public.sep_lessons;
create policy sep_lessons_edit on public.sep_lessons for update using (public.is_staff()) with check (public.is_staff());
