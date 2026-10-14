-- Prices by design, tiered (Oct 14, Nick: "it should just be one in there: Mewjira, 100 at 6.25, 150 at 6.00, 200 at
-- 5.50"); customer-supplied shirts (the shirt fields don't apply); archived instead of deleted.
alter table public.program_items add column if not exists tiers jsonb;
alter table public.program_items add column if not exists supplied boolean not null default false;
alter table public.program_items add column if not exists archived_at timestamptz;
