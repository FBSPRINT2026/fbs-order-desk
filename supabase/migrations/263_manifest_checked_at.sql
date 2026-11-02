-- The goods matcher remembers when it last looked at a waiting shipment line, and looks again only when something
-- changed: the line itself, or one of that customer's orders (Nov 2: each round re-read 100+ old shipments and ran out
-- of time before today's).
alter table public.supplier_manifest_lines add column if not exists checked_at timestamptz;
comment on column public.supplier_manifest_lines.checked_at is 'When the matcher last looked at this waiting line; it looks again only when something changed (the line, or one of the customer''s orders)';
