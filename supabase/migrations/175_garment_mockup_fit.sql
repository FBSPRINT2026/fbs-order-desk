-- Each style's own print-area spot in the Mockup Creator (Oct 20, 2026, Nick: "a PC55RS gets this spot"): dragged or
-- sized by hand with Print areas on, per side. { "front": { "dx": 0, "dy": 24.5, "k": 0.92 }, "back": {…} } in
-- reference-photo pixels (34 px per inch on the adult Large reference tee); k = the print area's size.
alter table public.garments add column if not exists mockup_fit jsonb;
