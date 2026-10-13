-- Opening older emails (Oct 13, Nick: Margaret Trame's conversation stuck on "Opening…"): about 1 in 10 cached emails
-- had no HTML kept (their pictures, pasted into the email, made the HTML too big), so each one was read live from the
-- mailbox, which waits when the mailbox is at its connection limit. The cache now keeps the HTML with the big pictures
-- left out (body_trimmed) and goes back once for the ones saved without it (body_fixed_at).
alter table public.mail_cache add column if not exists body_trimmed boolean not null default false;
alter table public.mail_cache add column if not exists body_fixed_at timestamptz;
