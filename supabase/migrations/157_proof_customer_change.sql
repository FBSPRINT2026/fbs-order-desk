-- The customer's art review (Oct 15, Nick): "approve with changes" is an approved proof with the customer's note;
-- "make changes, change it myself" keeps the version they made in their Mockup Creator (garments and prints, and
-- the mockup picture) on the proof, for the shop to check and send back as the new proof.
alter table proofs add column if not exists customer_change jsonb;
