-- Held back from QuickBooks by hand (Nov 12, Nick: invoices that differ from what Printavo put in QuickBooks): while set
-- (the reason), the invoice and its payments wait in the queue as needs review (lib/qbo/push.ts).
alter table orders add column if not exists qbo_hold text;
