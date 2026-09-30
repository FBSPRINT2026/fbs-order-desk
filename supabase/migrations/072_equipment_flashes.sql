-- Equipment Status: flash-cure units working on a press (a flash takes a head's spot; fewer working flashes can mean
-- a dark or puff print needs two rounds)
alter table production_equipment add column if not exists flashes_working smallint check (flashes_working is null or flashes_working >= 0);
alter table production_equipment_log add column if not exists flashes_working smallint;
