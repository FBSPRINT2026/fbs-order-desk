-- A design price can match by who and what (Oct 18, Nick: Nine18 / All My Sons): who = words in the order's name
-- ("All My Sons", "AMS"); what = the group's garment (style numbers or words: "ST650", "polo"). Both must hit.
alter table program_items add column if not exists match jsonb;
