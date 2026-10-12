-- Orders still in email (Oct 12): the in-hands date the AI read from a customer's order conversation, once per newest
-- email (read again when a new one comes in). Server only.
create table if not exists public.email_deadlines (
  activity_id uuid primary key,
  need_by date,
  firm boolean not null default false,
  what text not null default '',
  pieces integer,
  read_at timestamptz not null default now()
);
alter table public.email_deadlines enable row level security;
-- job reminders back on for the owners: from now on only what's due today or late, no to-dos
update public.staff set alerts = coalesce(alerts, '{}'::jsonb) - 'jobs' where lower(email) in ('nicholas@fbsprint.com', 'amanda@fbsprint.com');
