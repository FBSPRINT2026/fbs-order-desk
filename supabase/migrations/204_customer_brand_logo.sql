-- the customer's own company logo (Oct 24, Nick): a storage path in the proofs bucket, set from the portal's Settings;
-- their sales sheets carry it.
alter table customers add column if not exists brand_logo text;
