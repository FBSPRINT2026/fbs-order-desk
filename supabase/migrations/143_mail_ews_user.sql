-- EWS sign-in name when it isn't the email address (Oct 14: Nick's 22-year-old mailbox signs in to EWS as its old
-- Windows login, given by Intermedia support; IMAP accepts the email address).
alter table public.mail_accounts add column if not exists ews_user text;
update public.mail_accounts set ews_user = 'EXCH021\nicholas_franklinbus' where lower(email) = 'nicholas@fbsprint.com';
