-- The personal launch note from Nick or Amanda (Nov 3, Nick: "this should either come from Amanda or I… from our email…
-- only go to the main person on the account"): who gets it, who it's from, or that it isn't sent, and when it went.
alter table public.customers add column if not exists personal_note_to text[] not null default '{}';
alter table public.customers add column if not exists personal_note_from text;
alter table public.customers add column if not exists personal_note_skip boolean not null default false;
alter table public.customers add column if not exists personal_note_sent_at timestamptz;
