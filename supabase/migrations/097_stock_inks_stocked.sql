-- Which stock colors the shop actually carries. The maker's full line stays on file; a manager switches on the ones on
-- our shelf (Production → Ink Room → Choose what we stock). Everyone else sees only the stocked ones.
alter table public.stock_inks add column if not exists stocked boolean not null default true;
-- Monarch: the shop carries Khaki, Dark Brown, Bora Bora Sand and Maroon; the rest of the Monarch chart is off
update public.stock_inks set stocked = (name in ('Khaki','Dark Brown','Bora Bora Sand','Maroon') and line = 'Standard & Athletic')
where brand = 'Monarch Color';
