-- Order statuses, two layers (Oct 21, Nick: "customer facing versus internal statuses… implement the statuses the way we
-- edit them"): the shop's steps checked off by hand, and holds/flags beside the stage. Everything else is worked out
-- from what already happens (lib/orderStages.ts). Orders run from Printavo keep Printavo's status.
alter table public.orders add column if not exists stage_checks jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists flags jsonb not null default '[]'::jsonb;
