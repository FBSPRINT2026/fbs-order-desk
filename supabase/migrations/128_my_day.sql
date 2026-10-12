-- My Day (Oct 12): the AI organizer. Every email in a person's Inbox is sorted (customer / to-do / event / FYI /
-- ignore); to-dos and events land here, per person (owner = staff email). Server only (RLS on, no policies).
alter table public.mail_inbox add column if not exists bucket text;          -- customer | todo | event | fyi | ignore
alter table public.mail_inbox add column if not exists summary text not null default '';
alter table public.mail_inbox add column if not exists sorted_at timestamptz;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner text not null,                                  -- staff email it's for
  title text not null,
  notes text not null default '',
  area text not null default 'shop',                    -- personal | money | shop | customer
  due date,
  status text not null default 'open',                  -- open | done
  snooze_until date,
  source text not null default 'manual',                -- email | text | order | manual
  mail_inbox_id uuid references public.mail_inbox(id) on delete set null,
  message_id text not null default '',
  activity_id uuid references public.activities(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  created_by text not null default '',
  handed_by text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);
create index if not exists tasks_owner_open on public.tasks (owner, due) where status = 'open';
create index if not exists tasks_msg on public.tasks (owner, message_id);
alter table public.tasks enable row level security;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  title text not null,
  notes text not null default '',
  place text not null default '',
  starts_at timestamptz,                                -- timed events
  ends_at timestamptz,
  day date,                                             -- all-day events (and the day of a timed one)
  all_day boolean not null default false,
  status text not null default 'suggested',             -- suggested | added | dismissed
  source text not null default 'manual',
  mail_inbox_id uuid references public.mail_inbox(id) on delete set null,
  message_id text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists events_owner_day on public.events (owner, day);
alter table public.events enable row level security;

-- each person's private calendar link (the phone subscribes to /api/cal/<token>)
create table if not exists public.cal_feeds (
  owner text primary key,
  token text not null unique,
  shop boolean not null default true,                   -- include the shop's in-hands dates
  created_at timestamptz not null default now()
);
alter table public.cal_feeds enable row level security;
