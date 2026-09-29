-- A booked job can be pinned to a start time (minutes after midnight, shop time). Null = next open time on that machine.
alter table public.production_slots add column if not exists start_min integer check (start_min is null or (start_min >= 0 and start_min < 1440));
