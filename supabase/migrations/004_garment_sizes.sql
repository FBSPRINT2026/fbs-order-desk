-- Each catalog garment lists the sizes it comes in ("OS" = one size, e.g. hats)
alter table public.garments add column if not exists sizes text[] not null default '{}';
