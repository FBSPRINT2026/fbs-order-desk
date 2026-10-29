-- The sew-out records what was really sewn (Oct 29 2026, Nick: "we might not even have the thread in stock… we use
-- something close… select the real thread we used. It needs to go back and change it on the order form"; "we might take
-- another photo for placement"): the stitch file version and the threads sewn, what that changed on the order, and a
-- second, wider photo showing where it sits on the garment.
alter table public.sewouts add column if not exists placement_path text;
alter table public.sewouts add column if not exists sewn jsonb;
alter table public.sewouts add column if not exists changes jsonb;
