-- One ClickUp token per workspace (Oct 22, Nick: "Looks like I need an API for each workspace"): every Vercel variable
-- whose name starts with CLICKUP_API_TOKEN is read; each workspace remembers which one sees it (the name only).
alter table public.clickup_teams add column if not exists token_key text not null default '';
comment on column public.clickup_teams.token_key is 'Which Vercel variable (CLICKUP_API_TOKEN…) reads this workspace: one token per workspace (Oct 22). The name only, never the token.';
