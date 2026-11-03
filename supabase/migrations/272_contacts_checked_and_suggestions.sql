-- Update contacts (Nov 3, Nick: "build a update the contact tool… it shows the accounts… just the contacts first… help me
-- fill out that form"). When staff last checked a customer's contacts, and two lookups over the shop's mail index:
-- which customers' main email shows up in our mail, and who at a company we've been emailing with.
alter table public.customers add column if not exists contacts_checked_at timestamptz;
alter table public.customers add column if not exists contacts_checked_by text;

-- customers whose main email is in our mail (they wrote to us, or we wrote to them)
create or replace function public.customer_contact_seen()
returns table(customer_id uuid)
language sql stable security definer set search_path = public as $$
  with seen as (
    select lower(from_email) e from mail_index where from_email ~ '@'
    union
    select lower(x) from mail_index, unnest(to_list) x where x ~ '@'
  )
  select c.id from customers c where lower(trim(coalesce(c.email, ''))) in (select e from seen);
$$;

-- people in our mail on messages that mention any of these terms (a company's name, its web domain, an address of theirs):
-- one row per person per mailbox, with how many messages and the latest
create or replace function public.contact_suggestions(p_terms text[])
returns table(email text, name text, acct text, n bigint, last timestamptz)
language sql stable security definer set search_path = public as $$
  with hit as (
    select m.account_id, m.from_email, m.from_name, m.to_list, m.sent_at
    from mail_index m
    where exists (select 1 from unnest(p_terms) t where length(t) >= 4 and m.hay ilike '%' || t || '%')
    order by m.sent_at desc
    limit 4000
  ), people as (
    select lower(from_email) email, nullif(trim(from_name), '') nm, account_id, sent_at from hit
    union all
    select lower(x), null, account_id, sent_at from hit, unnest(to_list) x
  )
  select p.email, max(p.nm), a.email, count(*), max(p.sent_at)
  from people p join mail_accounts a on a.id = p.account_id
  where p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and p.email !~ '(@fbsprint\.com$|printavo|no-?reply|donotreply|mailer-daemon|notifications?@|bounce|@clickup|@sanmar|@ssactivewear|@alphabroder|@intuit|@quickbooks|@stax)'
  group by p.email, a.email;
$$;

revoke all on function public.customer_contact_seen() from public, anon, authenticated;
revoke all on function public.contact_suggestions(text[]) from public, anon, authenticated;
grant execute on function public.customer_contact_seen() to service_role;
grant execute on function public.contact_suggestions(text[]) to service_role;
