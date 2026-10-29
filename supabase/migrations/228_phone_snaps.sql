-- A photo taken on a phone for something open on a computer (lib/phoneSnap.ts, Oct 29 2026): the computer shows a QR
-- code with a short link (/snap/<id>), the phone takes the picture there, and the computer sees it arrive. Each link is
-- for one thing (a print's sew-out), made by one staff member, and works for 30 minutes.
create table if not exists phone_snaps (
  id text primary key,
  kind text not null,
  order_id uuid not null,
  target text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  result jsonb
);
create index if not exists phone_snaps_order on phone_snaps (order_id);
alter table phone_snaps enable row level security;
