-- Embroidery's own manager (Oct 23, Nick: Maria Guzman, embroidery@fbsprint.com): the embroidery role (lib/roles.ts)
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role = any (array['owner','admin','production','embroidery','receiving','shipping']));
