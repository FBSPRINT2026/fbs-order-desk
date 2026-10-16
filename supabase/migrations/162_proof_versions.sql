-- Proofs are only what the customer was sent (Oct 16 2026, Nick): Version 1 is the first one sent. Mockup saves live in
-- mockups; a send turns the current mockups into proofs with the next version. When the customer opens it, and a staff
-- approval "another way" (a call, an email) that overrides everything else.
alter table public.proofs add column if not exists version int;
alter table public.proofs add column if not exists sent_at timestamptz;
alter table public.proofs add column if not exists sent_to text;
alter table public.proofs add column if not exists viewed_at timestamptz;
alter table public.proofs add column if not exists last_viewed_at timestamptz;
alter table public.proofs add column if not exists view_count int not null default 0;
alter table public.proofs add column if not exists reminded_at timestamptz;
alter table public.proofs add column if not exists approved_via text;
alter table public.proofs add column if not exists mockup_id uuid;
-- applied Oct 16 with: #40070's approved proof = version 1, approved_via 'staff'; #40003's never-sent draft archived;
-- mockups no longer point at never-sent proofs.
