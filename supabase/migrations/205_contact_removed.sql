-- a person taken off a company (Oct 24, Nick): kept, not deleted; portal access off, hidden from the lists.
alter table customer_contacts add column if not exists removed_at timestamptz;
alter table customer_contacts add column if not exists removed_by text;
