-- Update contacts, every person at a company (Nov 3, Nick: "Scott Gray, Lyn, Lisa… their name, their email… who they are,
-- whether they get a contact or not… even their phone number… who want to have portal access"): what each person does
-- for the account (orders, art, billing), and the phone in their email signature.
alter table public.customer_contacts add column if not exists roles text[] not null default '{}';

-- the phone most often in each person's own signature (the part of their email above any quoted reply), our own numbers left out
create or replace function public.contact_phones(p_emails text[], p_skip text[])
returns table(email text, phone text)
language sql stable security definer set search_path = public as $$
  with b as (
    select lower(from_email) e,
      split_part(split_part(split_part(split_part(split_part(body_text, E'\n>', 1), 'Original Message', 1), E'\nFrom:', 1), ' wrote:', 1), E'\n________', 1) t
    from mail_cache
    where lower(from_email) = any(p_emails) and body_text is not null
  ), m as (
    select e, (regexp_matches(t, '(\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4})', 'g'))[1] ph from b
  ), c as (
    select e, ph, count(*) n from m where regexp_replace(ph, '\D', '', 'g') <> all(p_skip) group by e, ph
  )
  select distinct on (e) e, ph from c order by e, n desc;
$$;
revoke all on function public.contact_phones(text[], text[]) from public, anon, authenticated;
grant execute on function public.contact_phones(text[], text[]) to service_role;
