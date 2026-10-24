-- QuickBooks sales tax (Oct 24, Nick: "you either need to select it… tax exempt 0% or Texas sales tax 8.25%"): the
-- QuickBooks tax rate for orders with no sales tax. tax_code_id is the rate for taxed orders.
alter table qbo_settings add column if not exists exempt_tax_code_id text not null default '';
