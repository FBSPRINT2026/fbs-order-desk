-- Equipment Status → press layout: what sits at each print head of a screen press (head 1 first, after the load
-- station): "print", "flash" (a flash-cure unit parked there), "down" (head out), "flashdown" (flash not heating).
-- Load and unload aren't stored (every press has both), so a 12-color press stores 12 and draws 14 stations.
-- The separations / press-setup tool reads it to lay screens out around the flashes.
alter table production_equipment add column if not exists stations jsonb;
alter table production_equipment_log add column if not exists stations jsonb;
