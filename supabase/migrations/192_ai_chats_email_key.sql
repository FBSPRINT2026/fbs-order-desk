-- AI Workbench chats tied to an email (Oct 22): the Inbox Assistant's "do the work" requests (mockups, quotes) run
-- in a Workbench chat per person per email; this is which email ("<activity id>" or "inbox:<id>").
alter table public.ai_chats add column if not exists email_key text;
create index if not exists ai_chats_owner_email_key on public.ai_chats (owner, email_key) where email_key is not null;
