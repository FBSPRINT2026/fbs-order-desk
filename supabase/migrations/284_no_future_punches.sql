-- A punch can't be for a time that hasn't happened yet (Nov 4, Nick: Yolanda Ramirez "has not been at the office the
-- last 2 days… it's already showing clocked out at the end of today"). uAttend handed over whole days of punches at
-- midnight, before they happened (a schedule or auto punch). Any punch that comes in for more than 10 minutes ahead,
-- from any clock or sync, is kept but not counted (voided, with why); staff typing one in by hand is left alone.
create or replace function public.time_punches_not_future() returns trigger language plpgsql as $$
begin
  if new.at > now() + interval '10 minutes' and coalesce(new.source, '') <> 'manual' and not new.voided then
    new.voided := true;
    new.note := trim(both ' ' from coalesce(new.note, '') || ' · Not counted: it came in for ' || to_char(new.at at time zone 'America/Chicago', 'Mon FMDD FMHH12:MI AM') || ', a time that hadn''t happened yet (a schedule or auto punch, not a real one)');
  end if;
  return new;
end $$;
drop trigger if exists time_punches_not_future on public.time_punches;
create trigger time_punches_not_future before insert on public.time_punches for each row execute function public.time_punches_not_future();
