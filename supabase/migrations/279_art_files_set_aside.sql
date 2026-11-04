-- Files an order picked up while it was being made (pictures the reader cut from a PDF, files staff dropped in), set aside
-- when a customer's order is reset to their request (Nov 3, #40461: six "customer supplied mockups" cut from the
-- pre-production PDF stayed on the request after Reset). Moved here, never deleted: the row and its file are kept and can
-- be put back.
create table if not exists public.art_files_set_aside (
  id uuid primary key,
  order_id uuid,
  name text,
  file_path text,
  file_type text,
  category text,
  guess text,
  note text,
  created_at timestamptz,
  set_aside_at timestamptz not null default now(),
  set_aside_by text,
  reason text
);
alter table public.art_files_set_aside enable row level security;
