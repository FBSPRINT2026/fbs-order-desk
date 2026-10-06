-- Where a stock ink shows on the Ink Room's Stock colors tab (Nicholas, Oct 6): Wilflex Rio RFU first ("rfu"), then
-- every other stock color in one grid ("color"), then whites, bases and additives ("base"), and the Rio Mix ink mixing
-- system in its own panel at the bottom ("mixing").
alter table public.stock_inks add column if not exists section text not null default 'color' check (section in ('rfu', 'color', 'base', 'mixing'));
update public.stock_inks set section = 'rfu' where brand = 'Wilflex' and line = 'Rio RFU';
update public.stock_inks set section = 'mixing' where brand = 'Wilflex' and line = 'Rio Mix';
update public.stock_inks set section = 'base' where (brand = 'Wilflex' and line in ('Epic White', 'Epic Bases')) or line in ('Plastisol White', 'Additives') or (brand = 'InkTek' and name in ('Poly White', 'Solar White'));
