-- An email the mail server can't hand over by IMAP (Oct 13: one 9.5 MB email in Nick's Inbox dropped the connection
-- every time it was asked for, which ended each cache run there): tried twice, then left for Outlook.
alter table public.mail_cache add column if not exists body_tries integer not null default 0;
