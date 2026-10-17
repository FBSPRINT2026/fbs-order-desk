-- Brand standards beyond colors (Oct 16 2026, Nick): print sizes ("Peticolas' round logo is always 10.5" on the front,
-- 3" on the nape") and how their prints are made on dark shirts (fashion hit = no underbase, print-flash-print; soft hand
-- additive). { sizes: [{ id, which: any|round|wide|tall|design, design_id?, location, width, note }], hit: standard|fashion|ask,
-- soft: bool, distressedOnly: bool }
alter table public.customers add column if not exists brand_print jsonb not null default '{}'::jsonb;
