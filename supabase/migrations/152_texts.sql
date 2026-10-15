-- Customer texts from a Mac (Oct 15, Nick): the Mac mini signed in to Messages (Messages in iCloud) runs a small
-- sync (FBS Texts, /api/texts/agent) that sends the texts with customers, and their pictures, to the portal. Only
-- numbers and emails that belong to a customer or one of their contacts are sent; personal texts stay on the Mac.
-- Server only (RLS on, no policies): the portal reads them for owners.

create table if not exists text_devices (
  id uuid primary key default gen_random_uuid(),
  owner text not null,                          -- whose phone's texts these are (staff email)
  name text not null default '',                -- "Mac mini (Nick)"
  token_hash text not null unique,              -- sha256 of the device's token (the token itself is shown once)
  last_rowid bigint not null default 0,         -- how far through the Mac's Messages it has read
  handles_v text not null default '',           -- which customer numbers it last had (to pull a new one's older texts)
  last_seen_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table text_devices enable row level security;

create table if not exists text_messages (
  id uuid primary key default gen_random_uuid(),
  guid text not null unique,                    -- Messages' own id for the text
  device_id uuid references text_devices(id) on delete set null,
  owner text not null,                          -- whose phone (staff email)
  handle text not null,                         -- the other side: +12145551234 or an email
  chat text not null default '',                -- the conversation (a group chat has its own)
  chat_name text not null default '',
  from_me boolean not null default false,
  body text not null default '',
  sent_at timestamptz not null,
  service text not null default '',             -- iMessage / SMS
  customer_id uuid references customers(id) on delete set null,
  files jsonb not null default '[]'::jsonb,     -- [{ name, type, path (storage: proofs/texts/…), size }]
  created_at timestamptz not null default now()
);
alter table text_messages enable row level security;
create index if not exists text_messages_customer_idx on text_messages (customer_id, sent_at desc);
create index if not exists text_messages_handle_idx on text_messages (handle, sent_at desc);
create index if not exists text_messages_owner_idx on text_messages (owner, sent_at desc);
