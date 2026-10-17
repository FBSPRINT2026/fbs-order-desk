-- Draft art (Oct 17, Nick: "art should only be saved once an order is sent to the customer or saved"):
-- logos and mockups the portal makes by itself while building an order are drafts. They show on that order, not in
-- the customer's library or the customer portal, until the order is sent or approved, someone clicks Keep, or the logo
-- is saved in Edit logo. Deleting the order takes its drafts off with it.
alter table designs add column if not exists draft boolean not null default false;
alter table mockups add column if not exists draft boolean not null default false;

-- an order leaving quote (sent to the customer, approved, or any later status, however it happens): its draft art is
-- real from then on, joining the customer's library
create or replace function keep_order_art() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not null and new.status not in ('quote', 'request')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.groups is distinct from new.groups) then
    update designs set draft = false
     where draft and id::text in (
       select im->>'design_id'
         from jsonb_array_elements(case when jsonb_typeof(new.groups) = 'array' then new.groups else '[]'::jsonb end) g,
              jsonb_array_elements(case when jsonb_typeof(g->'imprints') = 'array' then g->'imprints' else '[]'::jsonb end) im
        where im ? 'design_id');
    update mockups set draft = false where draft and order_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists orders_keep_art on orders;
create trigger orders_keep_art after insert or update of status, groups on orders for each row execute function keep_order_art();

-- 167: drafts no one has used in 60 days are archived daily (pg_cron 'archive-stale-drafts' runs archive_stale_drafts())
-- (see the live function in the database; applied as migration 167_archive_stale_drafts)
