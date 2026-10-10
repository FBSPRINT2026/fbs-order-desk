-- Oct 10: tried opening Canva's own T-shirt designer for Design with Canva. Not used: that designer always opens
-- Canva's print shop (selling the shirt through Canva), which Nick doesn't want customers to see. Design with Canva
-- stays on our blank canvas. The column was applied live and is kept (additive only); nothing reads it.
alter table public.canva_sessions add column if not exists mode text not null default 'canvas';
