-- Print templates (Nov 18 2026, Nick: "give you templates and you make them, you fill them in"): a business card (or any
-- flat printed piece) saved once with its fixed art and the text lines staff fill in on a paper printing order.
-- data: { w, h (pt, the trim), sides: [{ name, png, pdf, box: {w, h}, trim: {x, y}, fields: [...] }] } (lib/printTemplates.ts)
create table if not exists print_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_id uuid references customers(id) on delete set null,
  kind text not null default 'business_card',
  data jsonb not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists print_templates_customer on print_templates(customer_id);
alter table print_templates enable row level security;
drop policy if exists print_templates_staff on print_templates;
create policy print_templates_staff on print_templates for all to authenticated using (is_staff()) with check (is_staff());
