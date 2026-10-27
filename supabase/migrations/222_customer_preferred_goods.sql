-- Brand standards → Preferred goods (Oct 26, Nick: "they prefer the Next Level 6210 over the 3001 CVC… if you read an
-- email and you can't determine what it is… go into their brand standards… and just ask to confirm"). Ranked per kind.
alter table public.customers add column if not exists preferred_goods jsonb not null default '[]'::jsonb;
comment on column public.customers.preferred_goods is 'Brand standards → Preferred goods (Oct 26, Nick): the blanks a customer orders, ranked per kind ([{id, kind, rank, style, brand, name, colors[], notes}]). Used only when an email doesn''t name the style, and only after staff confirm.';
