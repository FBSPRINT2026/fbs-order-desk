-- The print spots finished on a booking (the front printed, the back still to go; Nick, Nov 16 2026: "it should show on
-- the schedule… front finished"): set by the press timer on the phone, shown on the schedule's card
alter table production_slots add column if not exists sides_done text[] not null default '{}';
