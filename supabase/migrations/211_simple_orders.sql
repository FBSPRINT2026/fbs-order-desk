-- Simple orders from the portal (Oct 24, Nick: "upload a simple order… when's it due, where's it going, about how many
-- units, upload art, upload PO… tell us about the goods"): what they answered, kept on the order; the shop builds it
-- with Create order, which reads it like an email (an activity of kind 'portal'). Additive only.
alter table public.orders add column if not exists simple_order jsonb;
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind = any (array['note','call','email','meeting','task','sms','clickup','portal']));
