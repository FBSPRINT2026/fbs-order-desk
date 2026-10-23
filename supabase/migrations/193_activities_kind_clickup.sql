-- ClickUp jobs come in as activities of kind 'clickup' (lib/clickup.ts processTask), so the order maker runs on them
-- like an email (Oct 22, Nick: "new row violates check constraint activities_kind_check"). Widens the allowed kinds only.
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind = any (array['note','call','email','meeting','task','sms','clickup']));
