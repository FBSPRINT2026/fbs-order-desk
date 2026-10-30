-- The style that carries the sizes another style doesn't come in (Oct 30, Nick: "you brought in PC099Y as all of it…
-- there's no PC099Y adult sizes… we need to make a rule"). A youth style ordered in adult sizes goes to its adult
-- style, an adult style in youth sizes to its youth style, the same for toddler and infant sizes. Pairs come from the
-- catalog (one clear match) or staff (picked when Create order or the order page asks) and are used for everyone after.
-- Youth/adult pairs also stay in garment_youth (Add youth); this table holds every kind, keyed by style + size kind.
create table if not exists garment_size_pairs (
  style text not null,              -- the style the sizes were written on, upper case ("PC099Y")
  kind text not null,               -- the sizes it doesn't come in: adult / youth / toddler / infant
  sister text not null,             -- the style that carries them ("PC099")
  sister_brand text not null default '',
  source text not null default 'staff',  -- staff (picked or typed) / catalog (one clear match)
  by text not null default '',
  at timestamptz not null default now(),
  primary key (style, kind)
);
alter table garment_size_pairs enable row level security;
