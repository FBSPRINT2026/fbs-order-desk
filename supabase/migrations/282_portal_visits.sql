-- Who's been in the customer portal (Nov 4, Nick: "go tomorrow at lunch and be like, oh, who all's looked at it?"): one
-- row per customer login per half hour of use (lib/portal.ts getPortalCtx records it), read on Customers → Move to the
-- portal. Staff previews aren't counted.
create table if not exists public.portal_visits (
  id bigserial primary key,
  customer_id uuid references public.customers(id) on delete set null,
  email text not null,
  path text,
  at timestamptz not null default now()
);
create index if not exists portal_visits_customer_at on public.portal_visits (customer_id, at desc);
create index if not exists portal_visits_email_at on public.portal_visits (email, at desc);
alter table public.portal_visits enable row level security;
revoke all on public.portal_visits from anon, authenticated;
