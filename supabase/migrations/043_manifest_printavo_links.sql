-- Until go-live, jobs live in Printavo: manifest goods can link to a Printavo order (our read-only copy) too.
alter table public.supplier_manifest_lines add column if not exists archived_order_id uuid references public.archived_orders(id) on delete set null;
alter table public.supplier_manifest_lines add column if not exists suggest_archived_id uuid references public.archived_orders(id) on delete set null;
create index if not exists sml_archived_idx on public.supplier_manifest_lines (archived_order_id);
