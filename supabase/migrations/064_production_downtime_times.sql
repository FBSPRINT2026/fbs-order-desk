-- Downtime for part of a day (maintenance at noon, a repair 1-3 PM). Null start/end = the whole day off.
alter table production_days_off add column if not exists start_min int, add column if not exists end_min int;
alter table production_days_off drop constraint if exists production_days_off_times;
alter table production_days_off add constraint production_days_off_times check ((start_min is null and end_min is null) or (start_min >= 0 and end_min <= 1440 and end_min > start_min));
