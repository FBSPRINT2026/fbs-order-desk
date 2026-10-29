-- The customer's proof link (lib/proofLinks.ts, Oct 29 2026, Nick: "you send a link to the customer, says your proof is
-- available… this screen pops up… the PDF on the right… change notes and approve it, requires changes"): /proof/<id> opens
-- without a sign-in. One link per proof sent: an order's art proof version, or a sew-out. The link itself is the key, so
-- the id is long and random; the table is read and written only by the server.
create table if not exists proof_links (
  id text primary key,
  kind text not null check (kind in ('art', 'sewout')),
  order_id uuid not null,
  version int,
  sewout_id uuid,
  sent_to text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists proof_links_order on proof_links (order_id);
create index if not exists proof_links_sewout on proof_links (sewout_id);
alter table proof_links enable row level security;
