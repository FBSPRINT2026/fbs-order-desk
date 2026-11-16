-- the messages the site wrote for a customer before reasons existed get theirs (Nick, Nov 16 2026: a customer saying where
-- their goods come from is shipping info, no reply needed)
update public.messages set reason = 'tracking' where author_type = 'customer' and reason is null and body like '📦 Goods for #%';
update public.messages set reason = 'change' where author_type = 'customer' and reason is null and (body like 'Change request:%' or body like 'Changes to the quote:%' or body like 'Changes to the final invoice:%');
