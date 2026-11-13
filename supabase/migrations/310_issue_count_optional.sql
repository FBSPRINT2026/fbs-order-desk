-- An Issue can be marked without counting the pieces first (Nick, Nov 12 2026, #40478: "I need to be able to mark it
-- just missing right now"): pcs 0 = how many is to be counted.
alter table production_issues drop constraint if exists production_issues_pcs_check;
alter table production_issues add constraint production_issues_pcs_check check (pcs >= 0);
