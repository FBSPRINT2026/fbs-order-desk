-- Only the current mockup for an order group is kept in view (Oct 15, Nick: "it saved every version... It should
-- only be the one active version"). Saving new mockups for a group archives that group's earlier mockups and their
-- proofs instead of deleting them.
alter table mockups add column if not exists archived_at timestamptz;
alter table proofs add column if not exists archived_at timestamptz;
create index if not exists mockups_live_idx on mockups (customer_id) where archived_at is null;
create index if not exists proofs_live_idx on proofs (order_id) where archived_at is null;
