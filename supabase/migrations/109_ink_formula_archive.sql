-- Hide an IMS formula from the Ink Room without deleting it (the IMS import never touches this column).
alter table ink_formulas add column if not exists archived_at timestamptz;
alter table ink_formulas add column if not exists archived_note text;
