-- More than one rate card per customer (Oct 17, Nick: Nine18 has one per location / brand). rate_card stays the first
-- (default) card; rate_cards holds the others, each with an id and a name. apply_mode: 'auto' = new quotes use program
-- pricing by themselves; 'ask' = an Apply button on the order. orders.program_card = which card the order uses.
alter table programs add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table programs add column if not exists apply_mode text not null default 'auto';
alter table orders add column if not exists program_card text;
