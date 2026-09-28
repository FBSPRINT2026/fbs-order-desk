-- 038 tried to drop the first unique rule by its full name, but Postgres had shortened it; this drops the real one.
alter table public.supplier_manifest_lines drop constraint if exists supplier_manifest_lines_supplier_supplier_order_sku_box_tra_key;
