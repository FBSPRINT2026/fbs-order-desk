-- Punches made on a phone count right away but wait for a manager's OK on the Time Clock (Nick, Nov 16 2026: "Jose will
-- have to approve any clock ins done by the phone")
alter table time_punches add column if not exists needs_ok boolean not null default false;
alter table time_punches add column if not exists ok_by text;
alter table time_punches add column if not exists ok_at timestamptz;
create index if not exists time_punches_needs_ok on time_punches (needs_ok) where needs_ok;
