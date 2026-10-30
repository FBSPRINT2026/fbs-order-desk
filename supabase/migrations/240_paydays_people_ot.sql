-- A closed payday's summary for Past paydays (Oct 30, Nick: "save it as payday… stats… total employees, total dollar
-- amount"): how many were paid, overtime hours and its extra half, and how many repaid an advance.
alter table paydays add column if not exists people int;
alter table paydays add column if not exists ot_hours numeric(10,2);
alter table paydays add column if not exists ot_extra numeric(12,2);
alter table paydays add column if not exists advance_people int;
