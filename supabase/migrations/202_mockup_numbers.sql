-- Mockup numbers (Oct 24, Nick: "Mockups all need a number, just like you do with the artwork, D-10200… so that customers
-- can go and say, hey, here it is"): one number per mockup set (every shirt color saved together shares it, M-1001), kept
-- when the set is edited and saved again. A set is snapshot.set (saved to the customer's library) or an order's group.
create sequence if not exists mockup_number_seq start 1001;
alter table mockups add column if not exists number int;
create index if not exists mockups_number_idx on mockups (number);
create index if not exists mockups_set_idx on mockups ((snapshot->>'set'));

create or replace function mockup_set_number() returns trigger language plpgsql as $$
begin
  if new.number is null and new.snapshot ? 'set' then
    select m.number into new.number from mockups m
     where m.customer_id is not distinct from new.customer_id and m.snapshot->>'set' = new.snapshot->>'set' and m.number is not null
     order by m.created_at limit 1;
  end if;
  if new.number is null and new.order_id is not null and new.group_id is not null then
    select m.number into new.number from mockups m
     where m.order_id = new.order_id and m.group_id = new.group_id and m.number is not null
     order by m.created_at limit 1;
  end if;
  if new.number is null then new.number := nextval('mockup_number_seq'); end if;
  return new;
end $$;

drop trigger if exists mockups_number on mockups;
create trigger mockups_number before insert on mockups for each row execute function mockup_set_number();

-- the mockups already saved: one number per set, oldest first (pictures saved in the same minute under the same name
-- count as one set when they have no set id)
do $$
declare r record; n int;
begin
  for r in
    select key, array_agg(id) as ids from (
      select id, created_at, coalesce(snapshot->>'set',
        case when order_id is not null and group_id is not null then order_id::text || ':' || group_id end,
        coalesce(customer_id::text, '') || ':' || split_part(title, ' — ', 1) || ':' || date_trunc('minute', created_at)::text) as key
      from mockups where number is null
    ) k group by key order by min(created_at)
  loop
    n := nextval('mockup_number_seq');
    update mockups set number = n where id = any(r.ids);
  end loop;
end $$;
