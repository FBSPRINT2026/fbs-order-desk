-- Printavo history lock and backup (Nicholas, Sept 30, 2026): everything Printavo created before 2026 is history that
-- won't change. It's locked in the database itself (no code, sync or mistake can change or delete it), its copied
-- artwork can't be deleted or moved, and a downloadable backup package is kept (data_backups + the private
-- "backups" bucket). 2026 orders keep syncing as before.
--
-- To deliberately change a locked order (should never be needed): an owner runs, in the SQL editor,
--   alter table archived_orders disable trigger archived_orders_guard;  … ;  alter table archived_orders enable trigger archived_orders_guard;

alter table public.archived_orders add column if not exists locked boolean not null default false;
alter table public.printavo_sync add column if not exists freeze_before date;

create or replace function public.archived_orders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.locked then raise exception 'Printavo order #% is locked history (before 2026): it can''t be deleted', old.visual_id; end if;
    return old;
  end if;
  if old.locked then
    if not new.locked then raise exception 'Printavo order #% is locked history (before 2026): it can''t be unlocked here', old.visual_id; end if;
    if new.data is distinct from old.data or new.data_hash is distinct from old.data_hash or new.printavo_id is distinct from old.printavo_id
       or new.kind is distinct from old.kind or new.visual_id is distinct from old.visual_id or new.nickname is distinct from old.nickname
       or new.status_name is distinct from old.status_name or new.status_color is distinct from old.status_color
       or new.order_date is distinct from old.order_date or new.due_date is distinct from old.due_date
       or new.total is distinct from old.total or new.paid is distinct from old.paid or new.balance is distinct from old.balance
       or new.qty is distinct from old.qty or new.po_number is distinct from old.po_number or new.files_total is distinct from old.files_total then
      raise exception 'Printavo order #% is locked history (before 2026): its record can''t change', old.visual_id;
    end if;
    -- artwork can only be added (copies finishing, failed ones retried), never dropped or pointed somewhere else
    if exists (select 1 from jsonb_each_text(coalesce(old.files, '{}'::jsonb)) f
               where f.value not in ('failed', 'too-big') and (new.files ->> f.key) is distinct from f.value) then
      raise exception 'Printavo order #% is locked history (before 2026): its copied files can''t be removed', old.visual_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists archived_orders_guard on public.archived_orders;
create trigger archived_orders_guard before update or delete on public.archived_orders
  for each row execute function public.archived_orders_guard();

-- the copied artwork of a locked order: can't be deleted or moved (files live at proofs/printavo/<archived order id>/…)
create or replace function public.printavo_files_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if old.bucket_id = 'proofs' and old.name like 'printavo/%' then
    begin aid := split_part(old.name, '/', 2)::uuid; exception when others then aid := null; end;
    if aid is not null and exists (select 1 from public.archived_orders a where a.id = aid and a.locked) then
      if tg_op = 'DELETE' or new.name is distinct from old.name or new.bucket_id is distinct from old.bucket_id then
        raise exception 'This file belongs to a locked Printavo order (history before 2026): it can''t be deleted or moved';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists printavo_files_guard on storage.objects;
create trigger printavo_files_guard before update or delete on storage.objects
  for each row execute function public.printavo_files_guard();

-- backup packages (one row per build; the files are in the private "backups" bucket)
create table if not exists public.data_backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  folder text not null,
  status text not null default 'building',
  manifest jsonb,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.data_backups enable row level security;
drop policy if exists data_backups_staff on public.data_backups;
create policy data_backups_staff on public.data_backups for select using (public.is_staff());

insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

-- lock it: everything created in Printavo before 2026
update public.archived_orders set locked = true where order_date < '2026-01-01' and not locked;
update public.printavo_sync set freeze_before = '2026-01-01' where id = 1;
