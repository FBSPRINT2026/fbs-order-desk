-- one open separation per print, and one more for its youth set (location ends "(youth)") when the youth size differs
-- (Nov 2, Nick: #40307 is 11" adult, 9" youth: two sets of films)
create unique index if not exists separations_imprint_open2 on public.separations (order_id, imprint_id, (location ~* '\(youth\)\s*$')) where (status <> 'cancelled');
drop index if exists public.separations_imprint_open;
