-- Goods & Receiving fresh start (Oct 15, Nick: "we were uploading the manifests as a trial… a fresh start"). The trial's
-- manifest lines are kept here (not deleted) so they can be looked at or put back; the live table starts empty.
-- (Run Oct 15: 807 lines copied here, then removed from supplier_manifest_lines; settings.data.receivingIgnored /
-- receivingSeparate moved to settings.data.receivingTrialArchive.)
create table if not exists supplier_manifest_lines_archive (like supplier_manifest_lines including defaults);
alter table supplier_manifest_lines_archive add column if not exists archived_at timestamptz not null default now();
alter table supplier_manifest_lines_archive add column if not exists archived_why text not null default '';
alter table supplier_manifest_lines_archive enable row level security;
