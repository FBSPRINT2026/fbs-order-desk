-- A person's own check layout (Oct 30, Nick on Linda McCoy: "key in her hours… her miles on her truck and on her car, and
-- then tolls… like I have it on the checks"): hours typed in on payday instead of the time clock, the account their pay
-- goes on, and extra lines (mileage at a rate per mile, or a dollar amount; tolls). employees.check_setup holds the
-- layout; payday_lines.keyed holds what was typed for that payday.
alter table employees add column if not exists check_setup jsonb;
alter table payday_lines add column if not exists keyed jsonb;
