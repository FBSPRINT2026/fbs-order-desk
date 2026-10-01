-- How a logo prints, worked out once (lib/printPlan.ts) and shared by the Mockup Creator and the Separation Studio:
-- method (spot / simulated process), the inks (fades, middle screens, combined colors), the color count for the price,
-- and why in words. Null until the logo is first put on a mockup or separated.
alter table designs add column if not exists print_plan jsonb;
