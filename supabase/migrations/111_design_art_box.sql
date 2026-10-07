-- Where the art really sits in a design's file once its background is removed or its empty margins are cut off
-- (original pixels: x, y, w, h, and of: the file's w/h). The mockup sizes the logo by this, not by the file's box.
alter table designs add column if not exists art_box jsonb;
