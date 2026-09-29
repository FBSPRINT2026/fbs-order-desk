-- A job that wasn't marked done by the end of its day moves forward to today; remember the day it was first booked.
alter table public.production_slots add column if not exists rolled_from date;
