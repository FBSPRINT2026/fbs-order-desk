-- Take a Payment's PIN (Nov 3, Nick: "someone… go to my computer and accidentally charge somebody… once you hit go, you
-- have to put in the PIN"): kept only as a salted scrypt hash, with a lockout after wrong tries.
alter table public.staff add column if not exists pay_pin_hash text, add column if not exists pay_pin_fails integer not null default 0, add column if not exists pay_pin_locked_until timestamptz, add column if not exists pay_pin_set_at timestamptz, add column if not exists pay_pin_set_by text;
