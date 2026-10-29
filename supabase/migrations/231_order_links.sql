-- The customer's order page (Oct 29 2026, Nick: "option A… one email… it all comes together"): one link per order that
-- shows every step waiting on the customer (the proof, each sew-out, the quote, the deposit). Same table as proof links.
alter table proof_links drop constraint if exists proof_links_kind_check;
alter table proof_links add constraint proof_links_kind_check check (kind in ('art', 'sewout', 'order'));
