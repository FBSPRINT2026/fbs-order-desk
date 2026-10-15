-- Artwork fresh start (Oct 15, Nick: "get rid of all the artwork except 40003"): test mockups and separations are kept
-- here (not deleted; their files stay in storage) so they can be looked at or put back. Designs use designs.archived_at.
-- (Run Oct 15: 51 mockups and 41 separations moved here; 37 designs archived. Left: #40003's Terrible Toddler design and mockup.)
create table if not exists mockups_archive (like mockups including defaults);
alter table mockups_archive add column if not exists archived_at timestamptz not null default now();
alter table mockups_archive add column if not exists archived_why text not null default '';
alter table mockups_archive enable row level security;
create table if not exists separations_archive (like separations including defaults);
alter table separations_archive add column if not exists archived_at timestamptz not null default now();
alter table separations_archive add column if not exists archived_why text not null default '';
alter table separations_archive enable row level security;
