-- Message Center → Archive (Nov 6, Nick: "some of the messages just need to be… removed from list… just click archive…
-- I should be able to go back and view archive messages, just like any email"). A conversation is archived while
-- archived_at is after its last message: a new message from the customer brings it back. Unarchive sets it to null.
create table if not exists public.chat_archive (
  key text primary key,
  archived_at timestamptz default now(),
  archived_by text
);
alter table public.chat_archive enable row level security;
create policy chat_archive_staff on public.chat_archive for select using (is_staff());
