-- DraftPunk brew plans (Nick, Nov 24 2026: "make this recipe… where are you gonna brew… Friday… get the ingredients…
-- any minor substitutions… version one sub A"). A brew can be planned for a day before it's brewed; its plan keeps the
-- size, the version and the substitutions it's brewed with, and whether a substitution became the next version.
alter table dp_brews add column if not exists status text not null default 'brewed' check (status in ('planned', 'brewed'));
alter table dp_brews add column if not exists plan jsonb not null default '{}';
