-- The words in a ClickUp job's paperwork (its PO and other PDFs), read once and kept (Oct 30, Nick: "look at the
-- customer's POs that he sends us… all the ways he might say things"): what the order reader and the shop learn from,
-- and a record of the PO after ClickUp is cancelled. [{ id, name, url, text }]; read_at when it was read.
alter table public.clickup_tasks add column if not exists file_texts jsonb;
alter table public.clickup_tasks add column if not exists file_texts_at timestamptz;
