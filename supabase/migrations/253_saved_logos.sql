-- Saved logos (Oct 31, Nick: "you're just saving mockups unless we tell you to save a specific artwork… to their
-- customer file"). A logo is in a customer's library (the Artwork page's Saved logos, their Logos) only when someone
-- saved it there; every other logo stays in the background for the mockups and orders that use it. Nothing is deleted.
alter table public.designs add column if not exists saved boolean not null default false;
update public.designs d set saved = true
 where not d.draft
   and (d.specs ? 'master'
     or d.customer_id in (select id from public.customers where company in ('Dear Heart Designs','Cedar Promos','Little Groupies','Bullseye Ventures','Furry Feline Creatives','Peticolas Brewing','Nine18 Printing Solutions')));
create index if not exists designs_saved_idx on public.designs (customer_id) where saved;
