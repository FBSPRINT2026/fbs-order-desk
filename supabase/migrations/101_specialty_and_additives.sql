-- Specialty inks, bases and additives the shop carries (Nicholas, Oct 6): Wilflex (Avient) Epic Gold Shimmer and
-- Silver Shimmer, Epic Fashion Soft Base, an Avient Specialty Inks stretch additive, and International Coatings 220
-- Puff Additive. No PMS; swatches are a stand-in for the look.
insert into public.stock_inks (brand, line, name, product, pms, hex, notes, sort, stocked, created_by)
select v.brand, v.line, v.name, v.product, '', v.hex, v.notes, v.sort, true, 'Nicholas'
from (values
('Wilflex','Epic Shimmers','Gold Shimmer','85370PFX','#C9A646','Shimmer (metallic flake) ink.',80),
('Wilflex','Epic Shimmers','Silver Shimmer','15370PFX','#C4C7CA','Shimmer (metallic flake) ink. IMS uses it in some formulas (e.g. 875 C).',81),
('Wilflex','Epic Bases','Fashion Soft Base','10340PFX','#EEEBE3','Clear low-cure base for a soft, water-based look. If ours is a different fashion base, edit the name and number.',85),
('Avient Specialty Inks','Additives','Stretch Additive','','#EEEBE3','Mixed into ink for stretch fabrics. Add the product number from the can.',95),
('International Coatings','Additives','Puff Additive','220','#F4F4F0','Mixed into plastisol for a raised (puff) print.',96)
) v(brand, line, name, product, hex, notes, sort);
