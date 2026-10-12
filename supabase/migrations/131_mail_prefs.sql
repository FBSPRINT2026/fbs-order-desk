-- Email settings per person (Oct 12, Nick: "I don't want my emails to say 'Thanks, FBS Team' and then have my signature"):
-- the line replies end with (the signature goes under it) and whether the AI writes as you ("I") or as the shop ("we").
alter table public.mail_accounts add column if not exists sign_off text not null default 'Thanks,';
alter table public.mail_accounts add column if not exists write_as text not null default 'me';
