-- Each color's own supplier cost by size (Oct 20, 2026, Nick: the PC55RS White/Royal 4XL is $7.98 over a $4.44 base,
-- but the style-wide cheapest prices, $5.61 over $4.07, gave +$1.85). { "White/ Royal": { "S": 4.44, …, "4XL": 7.98 } }.
alter table public.garments add column if not exists color_size_costs jsonb;
