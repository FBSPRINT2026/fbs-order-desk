-- Brand style guides a customer gave us (Oct 16, Nick: "some brands give us style guides… just upload them and they
-- should be on the customer's files"). Files in storage (proofs/brand-guides/<customer>/guides/…); this is the list:
-- [{ id, name, path, type, size, at, by, archived? }]. Taking one off archives it; the file stays.
alter table public.customers add column if not exists style_guides jsonb not null default '[]'::jsonb;
