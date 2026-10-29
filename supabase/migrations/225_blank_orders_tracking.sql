-- Oct 29: added for the order's Goods panel, then not used: our goods' boxes and tracking live in blank_shipments (the
-- nightly supplier manifests and the panel's Add both write there). Left in place (columns are never dropped).
alter table blank_orders add column if not exists tracking jsonb not null default '[]'::jsonb;
