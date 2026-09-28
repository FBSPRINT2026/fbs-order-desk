-- Customer goods on a manifest that aren't linked to an order yet.
--   customer_id: whose goods they are (known from the supplier account), even with no order
--   part: a line split between several of the customer's orders (one PO, several jobs) becomes part 0, 1, 2…
--   suggest_*: our best guess at the order(s), waiting for someone to say OK in the resolution center
--   track_*: live tracking for shipments we can't put on an order yet
alter table public.supplier_manifest_lines add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.supplier_manifest_lines add column if not exists part integer not null default 0;
alter table public.supplier_manifest_lines add column if not exists suggest_order_id uuid references public.orders(id) on delete set null;
alter table public.supplier_manifest_lines add column if not exists suggest_how text not null default '';
alter table public.supplier_manifest_lines add column if not exists linked_by text not null default '';
alter table public.supplier_manifest_lines add column if not exists tracker_id text not null default '';
alter table public.supplier_manifest_lines add column if not exists track_status text not null default '';
alter table public.supplier_manifest_lines add column if not exists track_detail text not null default '';
alter table public.supplier_manifest_lines add column if not exists est_delivery timestamptz;
alter table public.supplier_manifest_lines add column if not exists delivered_at timestamptz;
alter table public.supplier_manifest_lines add column if not exists track_updated_at timestamptz;
alter table public.supplier_manifest_lines drop constraint if exists sml_dedupe;
alter table public.supplier_manifest_lines add constraint sml_dedupe unique (supplier, supplier_order, sku, box, tracking, style, color, size, part);
create index if not exists sml_customer_idx on public.supplier_manifest_lines (customer_id, kind);
