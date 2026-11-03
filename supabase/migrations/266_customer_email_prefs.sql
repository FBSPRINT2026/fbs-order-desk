-- Customer emails (Nov 3, Nick): who at the customer gets each kind of email, and outbound tracking for
-- "delivered" / "delivery issue" emails. Additive only.
alter table public.customers add column if not exists email_prefs jsonb not null default '{}'::jsonb;
alter table public.shipments add column if not exists tracker_id text, add column if not exists track_status text, add column if not exists track_detail text, add column if not exists delivered_at timestamptz, add column if not exists track_updated_at timestamptz, add column if not exists notified jsonb not null default '{}'::jsonb;
