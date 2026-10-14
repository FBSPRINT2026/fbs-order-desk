-- A contact added to a customer (Oct 14: Cheri Ong added to Furry Feline after her Mewjira reprint email came in): her
-- recent emails that weren't linked to anyone (new leads) are linked to that customer, so Create order works on them.
create or replace function public.link_contact_emails() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.email, '') <> '' then
    update public.activities
       set customer_id = new.customer_id, meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lead', false, 'linked_by', 'contact')
     where customer_id is null and kind = 'email' and lower(from_email) = lower(new.email) and occurred_at > now() - interval '90 days';
  end if;
  return new;
exception when others then
  return new; -- never fail adding a contact
end $$;
drop trigger if exists customer_contacts_link_emails on public.customer_contacts;
create trigger customer_contacts_link_emails after insert or update of email on public.customer_contacts
  for each row execute function public.link_contact_emails();
