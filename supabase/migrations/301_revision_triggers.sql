-- Revision set and cleared on its own (Nov 9, Nick): the customer asks for changes on the quote, the mockup or a sew-out
-- while it's a quote → Revision (status quote + revision_at); the new version sent (Quote Sent) or the order moving on → not
create or replace function order_revision_on_changes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('quote_changes', 'proof_changes', 'sewout_changes') then
    update orders set status = 'quote', revision_at = now() where id = new.order_id and type = 'quote' and status in ('quote', 'quote_sent', 'art');
  end if;
  return new;
end $$;
drop trigger if exists order_events_revision on order_events;
create trigger order_events_revision after insert on order_events for each row execute function order_revision_on_changes();

create or replace function order_revision_clear() returns trigger language plpgsql as $$
begin
  if new.revision_at is not null and new.status is distinct from old.status and new.status <> 'quote' then new.revision_at := null; end if;
  return new;
end $$;
drop trigger if exists orders_revision_clear on orders;
create trigger orders_revision_clear before update of status on orders for each row execute function order_revision_clear();
