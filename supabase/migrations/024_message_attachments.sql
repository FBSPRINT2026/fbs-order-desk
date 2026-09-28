-- Files sent with a message (photos, logos, PDFs): [{ path, name, mime, size }] in the private proofs bucket under messages/<customer id>/
alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;
