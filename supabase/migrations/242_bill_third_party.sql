-- Bill third party (Oct 30, Nick: "in the delivery area on shipping… a check mark for bill third party… the FedEx third
-- party or the UPS account number"): the carrier account the shipment is billed to, on the order, and the customer's last
-- one so the next order fills it in. { carrier: 'FedEx'|'UPS', account, zip, name }
alter table public.orders add column if not exists third_party jsonb;
alter table public.customers add column if not exists third_party jsonb;
-- (the customer's usual account is kept in customers.ship_bill / ship_ups_account / ship_fedex_account / ship_bill_zip, the
-- Shipping center's; customers.third_party is unused)
