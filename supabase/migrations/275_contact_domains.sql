-- web domains in our mail that hold a word of a company's name (Nov 3, Nick: "Gateway is gatewaystaff.com… you should
-- have gotten that somehow"): how many messages came from each, the busiest first
create or replace function public.contact_domains(p_words text[])
returns table(domain text, n bigint)
language sql stable security definer set search_path = public as $$
  select split_part(lower(from_email), '@', 2) d, count(*)
  from mail_index
  where from_email ~ '@' and from_email !~* '(fbsprint\.com$|no-?reply|donotreply|mailer-daemon|bounce)'
    and exists (select 1 from unnest(p_words) w where length(w) >= 4 and split_part(lower(from_email), '@', 2) like '%' || w || '%')
  group by 1 having count(*) >= 5 order by 2 desc limit 40;
$$;
revoke all on function public.contact_domains(text[]) from public, anon, authenticated;
grant execute on function public.contact_domains(text[]) to service_role;
