-- who the sharer asked to watch (Nov 6, Nick: "have it so i can share my screen to train"); null = the owner, as before
alter table public.screen_sessions add column if not exists invite_emails text[];
