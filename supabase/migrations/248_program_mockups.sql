-- Program & training (Oct 30, Nick: "on your rate card… have an item at the end of each line that showed which mock-up it
-- used… with All My Sons the key indicator is the garment; with Peticolas the key indicator is the design").
-- Each program price can name the saved mockups that ARE it: [{ n: <mockup number>, colors?: [garment colors] }]; no
-- colors = any color. Create order puts a garment the price covers straight into that mockup's group (lib/masterMockups.ts).
alter table program_items add column if not exists mockups jsonb not null default '[]'::jsonb;
-- what picks the price on a job: the garment (its style) or the design (the words they call it)
alter table programs add column if not exists leads text not null default 'garment';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'programs_leads_check') then
    alter table programs add constraint programs_leads_check check (leads in ('garment', 'design'));
  end if;
end $$;
