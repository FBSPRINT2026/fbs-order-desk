-- Where the bottom of the sewn front neckline is on each garment photo (Oct 20, Nick: "when we say a drop, we mean it
-- right from [the bottom of the neckline]"). Every print's drop is measured from it. Found once per photo (the pixel
-- finder offers lines, the AI picks one), and a staff fix replaces it for good.
create table if not exists public.garment_necks (
  photo text primary key,            -- the supplier photo path (S&S "Images/Color/…_f_fl.jpg" or the SanMar URL)
  neck integer not null,             -- px from the top of the photo drawn 1000x1250 (contained, centered on white)
  source text not null default 'ai', -- 'ai' (picked by the AI), 'staff' (set by hand), 'auto' (pixel finder only)
  note text,
  set_by text,
  updated_at timestamptz not null default now()
);
alter table public.garment_necks enable row level security;
-- read and written through /api/mockup/neck only (service role)
