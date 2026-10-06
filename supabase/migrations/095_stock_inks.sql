-- The shop's stock inks: ready-to-use colors kept on the shelf, any brand or line (Wilflex Rio RFU, Monarch Color…),
-- each with its approximate PMS so the Ink Room can say "in stock" instead of mixing. Edited in Production → Ink Room.
-- Archived, never deleted.
create table if not exists public.stock_inks (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  line text not null default '',
  name text not null,
  product text not null default '',
  pms text not null default '',
  hex text not null default '',
  notes text not null default '',
  sort integer not null default 0,
  archived_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_inks_pms_idx on public.stock_inks (lower(pms)) where archived_at is null;
alter table public.stock_inks enable row level security;
create policy stock_inks_staff on public.stock_inks for all using (public.is_staff()) with check (public.is_staff());

-- starting list: Avient's Rio RFU standard colors (approximate PMS from the color card) and Monarch Bora Bora Sand
insert into public.stock_inks (brand, line, name, product, pms, hex, notes, sort, created_by) values
('Wilflex','Rio RFU','Lemon Yellow','80550','108 C','#FEDF25','',1,'setup'),
('Wilflex','Rio RFU','Yellow','80108','123 C','#FEC900','',2,'setup'),
('Wilflex','Rio RFU','Light Gold','80100','2010 C','#FEB217','',3,'setup'),
('Wilflex','Rio RFU','Gold','80000','137 C','#FEAC36','',4,'setup'),
('Wilflex','Rio RFU','Dolphin Orange','30400','1585 C','#F46725','',5,'setup'),
('Wilflex','Rio RFU','Bright Orange','30200','1665 C','#E84B2A','',6,'setup'),
('Wilflex','Rio RFU','Scarlet','40000','485 C','#D53A36','',7,'setup'),
('Wilflex','Rio RFU','National Red','43000','2034 C','#CC3539','',8,'setup'),
('Wilflex','Rio RFU','Drake Red','42270','1805 C','#CD2A36','',9,'setup'),
('Wilflex','Rio RFU','Dallas Scarlet','42000','7621 C','#A4303D','',10,'setup'),
('Wilflex','Rio RFU','Maroon','45400','504 C','#55343C','',11,'setup'),
('Wilflex','Rio RFU','Brandywine','47600','219 C','#C23878','',12,'setup'),
('Wilflex','Rio RFU','Russell Purple','50400','7680 C','#50386B','',13,'setup'),
('Wilflex','Rio RFU','Aqua','75300','2397 C','#00A6AF','',14,'setup'),
('Wilflex','Rio RFU','Contact Blue','60650','2193 C','#008CC9','',15,'setup'),
('Wilflex','Rio RFU','Light Royal','62100','2145 C','#00539C','',16,'setup'),
('Wilflex','Rio RFU','Royal','67050','2131 C','#284998','',17,'setup'),
('Wilflex','Rio RFU','Bears Navy','66100','2768 C','#323657','',18,'setup'),
('Wilflex','Rio RFU','Navy','60000','533 C','#2F374C','',19,'setup'),
('Wilflex','Rio RFU','Black Diamond','','Black 3 C','#1D2722','',20,'setup'),
('Wilflex','Rio RFU','Black Light Green','75900','802 C','#5BD740','',21,'setup'),
('Wilflex','Rio RFU','Kelly Green','70550','3522 C','#008346','',22,'setup'),
('Wilflex','Rio RFU','Dark Green','74550','626 C','#305346','',23,'setup'),
('Wilflex','Rio RFU','Russell Gray','13300','427 C','#BABCBD','',24,'setup'),
('Wilflex','Rio RFU','Dark Gray','14600','430 C','#868E93','',25,'setup'),
('Wilflex','Rio RFU','Tan','12600','148 C','#ECBD83','',26,'setup'),
('Wilflex','Rio RFU','Electric Yellow','','923 C','#EDFE00','',27,'setup'),
('Wilflex','Rio RFU','Electric Orange','','811 C','#FE6424','',28,'setup'),
('Wilflex','Rio RFU','Electric Red','','805 C','#FE2928','',29,'setup'),
('Wilflex','Rio RFU','Electric Pink','','812 C','#FE3788','',30,'setup'),
('Wilflex','Rio RFU','Electric Purple','90810','254 C','#A8358D','',31,'setup'),
('Wilflex','Rio RFU','Electric Blue','90110','3005 C','#0075BD','',32,'setup'),
('Wilflex','Rio RFU','Electric Green','90210','354 C','#00B03C','',33,'setup'),
('Monarch Color','','Bora Bora Sand','','','#D9C3A0','Which Monarch line? Vivid LB is MP9-0119, Apocalypse LB is MP9-0108. Add the PMS from the can or Monarch''s chart.',100,'setup');
