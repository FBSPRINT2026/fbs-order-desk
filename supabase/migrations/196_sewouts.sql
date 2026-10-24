-- Sew-out approval (Oct 24, Nick: "we sent it off to get digitized… then we do a sew out, like a physical… we have to
-- send them a picture… when our embroidery team does the sew out and they take a picture, automatically send an email for
-- approval… crop it… put it on a PDF that has approval like our proof approval does… then you approve that, on file for
-- future reference"). One row per photo of a sew-out of one embroidered print; a newer photo of the same print is the next
-- version and the one before steps aside (archived). Never deleted.
create table if not exists public.sewouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  imprint_id text not null,
  design_id uuid references public.designs(id),
  version integer not null default 1,
  photo_path text not null,
  raw_path text,
  note text not null default '',
  sent_at timestamptz,
  sent_to text,
  viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes')),
  decided_at timestamptz,
  decided_name text,
  customer_comment text not null default '',
  approved_via text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists sewouts_order_idx on public.sewouts (order_id);
create index if not exists sewouts_design_idx on public.sewouts (design_id);
alter table public.sewouts enable row level security;
create policy sewouts_staff on public.sewouts for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy sewouts_customer on public.sewouts for select using (order_id in (select public.my_order_ids()));
