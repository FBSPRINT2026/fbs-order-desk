-- The email list shows a paperclip like Outlook (Oct 16, Nick): whether an email in the Inbox has attachments,
-- read from its structure on each mailbox check (inline pictures in the body don't count).
alter table public.mail_inbox add column if not exists has_attachments boolean not null default false;
