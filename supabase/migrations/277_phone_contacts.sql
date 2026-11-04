-- Contacts from staff's phones (Nov 3, Nick sent his as a vCard: "pull from my phone contacts… Christine Martin at
-- Team Izzy"): name, company, title, emails, phones and address, used to fill in customers' contacts on Update contacts.
-- Shop staff only (read through the service role).
create table if not exists public.phone_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null default '',
  org text not null default '',
  title text not null default '',
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  address text not null default '',
  imported_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists phone_contacts_owner on public.phone_contacts (owner_email);
alter table public.phone_contacts enable row level security;
revoke all on public.phone_contacts from anon, authenticated;
