-- Prices by design: a back picture as well as the front (Oct 14, Nick: "the pictures should have a front and back").
alter table public.program_items add column if not exists image_back text not null default '';
