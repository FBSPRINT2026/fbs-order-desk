-- Reduced capacity instead of stopped: e.g. the press operator is out, the press still runs at 50% (jobs take twice as
-- long). capacity = percent the machine runs at during that time (null or 0 = stopped). employee = who is out.
alter table production_days_off add column if not exists capacity int, add column if not exists employee text not null default '';
alter table production_days_off drop constraint if exists production_days_off_capacity;
alter table production_days_off add constraint production_days_off_capacity check (capacity is null or (capacity >= 0 and capacity <= 100));
