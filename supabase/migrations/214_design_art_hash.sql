-- A small fingerprint of what a logo looks like (64-bit difference hash of its preview), so an upload of art the
-- customer already has is caught (Oct 24, Nick: "we've already got this… Is this different than D10201? Or would you
-- like to use that instead?"). Filled in as logos are uploaded or compared. Additive only.
alter table public.designs add column if not exists art_hash text;
