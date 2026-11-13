-- The Ink Room's stocked inks copied into settings.data.stockInks (Nick, Nov 12 2026, #40481): prices are worked out
-- in many places (the order page, the QuickBooks sync, the portal, server actions) and all of them read the settings.
-- Pages already loaded the stocked inks for themselves; the server didn't, so "Black Light Green" read as a black ink
-- there (no underbase: $2.70 a shirt and 2 screens instead of $3.20 and 4). Kept in step both ways: any change to a
-- stock ink rewrites the list, and any save of the settings puts the current list back (never a stale copy).
create or replace function stock_inks_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'hex', hex, 'line', coalesce(line, '')) order by name), '[]'::jsonb)
  from stock_inks where stocked and archived_at is null and coalesce(hex, '') <> ''
$$;

create or replace function settings_keep_stock_inks() returns trigger language plpgsql as $$
begin
  new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{stockInks}', stock_inks_list());
  return new;
end $$;
drop trigger if exists settings_keep_stock_inks on settings;
create trigger settings_keep_stock_inks before insert or update on settings for each row execute function settings_keep_stock_inks();

create or replace function stock_inks_to_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update settings set data = data where id = 1;
  return null;
end $$;
drop trigger if exists stock_inks_to_settings on stock_inks;
create trigger stock_inks_to_settings after insert or update or delete on stock_inks for each statement execute function stock_inks_to_settings();

update settings set data = data where id = 1;
