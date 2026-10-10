-- Design with Canva on the blank's photo (Oct 10): the Mockup Creator draws the garment photo (normalized like the
-- mockup, the print area dashed on it) and it becomes the Canva design's picture. backdrop = { w, h, k, view, z, tx, ty }:
-- the picture's size in pixels (how it's found again in Canva's PDF and taken out), the scale over the reference
-- frame and the photo's normalization (to put the art back where it was drawn). Kept on the design for Edit in Canva.
alter table public.canva_sessions add column if not exists backdrop jsonb;
alter table public.designs add column if not exists canva_backdrop jsonb;
