-- Ship on a customer's own carrier account (Oct 30, Nick: Nine18 ships from its own FedEx account, "Nine18 FEDEX"
-- 246741185, connected in EasyPost): the EasyPost carrier account id their labels are rated and bought on. Empty = FBS's.
alter table public.customers add column if not exists ship_on text not null default '';
alter table public.shipments add column if not exists ship_on text not null default '';
