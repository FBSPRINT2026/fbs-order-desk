-- A whole day's real hours from a phone (Nick, Nov 16 2026: "these were my actual hours for the day"): the person picks
-- what happened and writes the day's punches; Jose approves and only then the day's punches are replaced (old ones voided).
alter table public.time_fix_requests add column if not exists punches jsonb;
alter table public.time_fix_requests add column if not exists reason text not null default '';
alter table public.time_fix_requests drop constraint if exists time_fix_requests_kind_check;
alter table public.time_fix_requests add constraint time_fix_requests_kind_check check (kind in ('lunch', 'missed_in', 'missed_out', 'other', 'day'));
