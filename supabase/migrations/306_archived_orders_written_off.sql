-- A Printavo-era balance written off (Nov 12, Nick: written off in QuickBooks long ago, left showing in the portal in case
-- they paid). The amount written off is kept here; balance goes to 0 and the row is locked so a Printavo re-read never
-- brings the balance back.
alter table archived_orders add column if not exists written_off numeric, add column if not exists written_off_at timestamptz, add column if not exists written_off_note text;
