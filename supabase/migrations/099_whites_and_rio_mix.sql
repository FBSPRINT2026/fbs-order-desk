-- The shop's whites and the Epic Rio mixing inks (Nicholas, Oct 6): Wilflex Epic Amazing Bright Tiger White (K2200) is
-- our white, Rutland NPT Super Poly White (EL9746) our poly white, and we stock all 18 Wilflex Epic Rio Mix inks
-- (the inks the IMS formulas weigh out). Mixing-ink swatches are approximate; they have no PMS.
insert into public.stock_inks (brand, line, name, product, pms, hex, notes, sort, stocked, created_by)
select v.brand, v.line, v.name, v.product, '', v.hex, v.notes, v.sort, true, 'Nicholas'
from (values
('Wilflex','Epic White','Amazing Bright Tiger White','K2200','#FFFFFF','Our white ink.',50),
('Rutland','Plastisol White','Super Poly White','EL9746','#FFFFFF','Our poly white (NPT, for polyester).',90),
('Wilflex','Rio Mix','Rio Mix White','110RX','#FFFFFF','Epic Rio mixing ink. Swatch approximate.',60),
('Wilflex','Rio Mix','Rio Mix Deep Black','190RX','#1A1A1A','Epic Rio mixing ink. Swatch approximate.',61),
('Wilflex','Rio Mix','Rio Mix Blaze Orange','380RX','#FF5F1F','Epic Rio mixing ink. Swatch approximate.',62),
('Wilflex','Rio Mix','Rio Mix Red','470RX','#B5232F','Epic Rio mixing ink. Swatch approximate.',63),
('Wilflex','Rio Mix','Rio Mix Barberry Maroon','480RX','#8E2A3A','Epic Rio mixing ink. Swatch approximate.',64),
('Wilflex','Rio Mix','Rio Mix Majestic Magenta','490RX','#9B1B5A','Epic Rio mixing ink. Swatch approximate.',65),
('Wilflex','Rio Mix','Rio Mix Deep Violet','580RX','#4B2A84','Epic Rio mixing ink. Swatch approximate.',66),
('Wilflex','Rio Mix','Rio Mix Midnight Blue','670RX','#1F3A78','Epic Rio mixing ink. Swatch approximate.',67),
('Wilflex','Rio Mix','Rio Mix Aquamarine','680RX','#00507A','Epic Rio mixing ink. Swatch approximate.',68),
('Wilflex','Rio Mix','Rio Mix Indigo Blue','690RX','#1F2BC8','Epic Rio mixing ink. Swatch approximate.',69),
('Wilflex','Rio Mix','Rio Mix Forest Green','780RX','#116B2E','Epic Rio mixing ink. Swatch approximate.',70),
('Wilflex','Rio Mix','Rio Mix Sunshine Yellow','880RX','#FFD200','Epic Rio mixing ink. Swatch approximate.',71),
('Wilflex','Rio Mix','Rio Mix Golden Yellow','890RX','#F5A800','Epic Rio mixing ink. Swatch approximate.',72),
('Wilflex','Rio Mix','Rio Mix Electric Pink','900RX','#F0168C','Epic Rio mixing ink. Swatch approximate.',73),
('Wilflex','Rio Mix','Rio Mix Electric Red','940RX','#F21D2B','Epic Rio mixing ink. Swatch approximate.',74),
('Wilflex','Rio Mix','Rio Mix Electric Purple','950RX','#D21FE0','Epic Rio mixing ink. Swatch approximate.',75),
('Wilflex','Rio Mix','Rio Mix Electric Blue','960RX','#1E7ACC','Epic Rio mixing ink. Swatch approximate.',76),
('Wilflex','Rio Mix','Rio Mix Electric Yellow','980RX','#F2F200','Epic Rio mixing ink. Swatch approximate.',77)
) v(brand, line, name, product, hex, notes, sort);
