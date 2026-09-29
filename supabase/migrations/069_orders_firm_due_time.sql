-- Firm in-hands: the date (and optionally the time, e.g. Friday 10:00 AM) can't slip; the calendar pins and flags it.
alter table orders add column if not exists firm boolean not null default false;
alter table orders add column if not exists due_time smallint check (due_time is null or (due_time >= 0 and due_time < 1440));
comment on column orders.firm is 'Firm in-hands date: can not move';
comment on column orders.due_time is 'Needed by this time on the in-hands date, minutes after midnight (null = end of day)';
