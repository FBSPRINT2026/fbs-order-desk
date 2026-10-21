-- Pictures on a customer text the Mac couldn't upload (kept in iCloud only, not on the Mac): shown as "on your iPhone
-- only" and asked for again on the daily pictures pass (Oct 21, Nick: the 12/21/23 picture to Brooke wasn't found).
alter table public.text_messages add column if not exists files_missing jsonb;
comment on column public.text_messages.files_missing is 'Pictures on this text the Mac could not upload (not on the Mac: kept in iCloud only): [{id, name, at}]. Cleared as they arrive.';
