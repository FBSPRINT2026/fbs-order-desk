-- Printavo census: a list of every Printavo order (number, date, customer) plus file sizes for a random sample,
-- used to estimate how much storage a full import needs. Nothing is copied; only sizes are read.
create table if not exists public.printavo_census (
  printavo_id text primary key,
  visual_id text not null default '',
  kind text not null default 'invoice',
  created_at timestamptz,
  customer_pid text not null default '',
  company text not null default '',
  total numeric not null default 0,
  rnd double precision not null default random(),   -- random order for picking the sample
  files integer,          -- full-size files on the order (mockups + production files), null until measured
  bytes bigint,           -- their combined size
  largest bigint,
  unknown integer,        -- files whose size couldn't be read
  measured_at timestamptz,
  error text,
  listed_at timestamptz not null default now()
);
create index if not exists printavo_census_rnd_idx on public.printavo_census (rnd) where measured_at is null;
alter table public.printavo_census enable row level security;
drop policy if exists printavo_census_staff on public.printavo_census;
create policy printavo_census_staff on public.printavo_census for all using (public.is_staff()) with check (public.is_staff());

-- Summary with a per-year estimate: each year's order count x that year's measured average (overall average when a year has < 8 samples).
create or replace function public.printavo_census_summary() returns jsonb
language sql stable security invoker set search_path = public as $$
  with y as (
    select extract(year from created_at)::int yr, count(*) n,
           count(*) filter (where measured_at is not null and error is null) m,
           avg(bytes) filter (where measured_at is not null and error is null) avg_b,
           sum(files) filter (where measured_at is not null and error is null) f
    from printavo_census group by 1
  ), o as (
    select count(*) m, avg(bytes) avg_b, stddev_samp(bytes) sd, max(largest) largest,
           percentile_cont(0.5) within group (order by bytes) med,
           avg(files) avg_f, count(*) filter (where files = 0) nofiles
    from printavo_census where measured_at is not null and error is null
  )
  select jsonb_build_object(
    'orders', (select count(*) from printavo_census),
    'customers', (select count(distinct customer_pid) from printavo_census),
    'measured', o.m, 'errors', (select count(*) from printavo_census where error is not null),
    'avg_bytes', round(o.avg_b), 'median_bytes', round(o.med::numeric), 'sd_bytes', round(o.sd), 'avg_files', round(o.avg_f, 2),
    'no_files', o.nofiles, 'largest', o.largest,
    'over_45mb', (select count(*) from printavo_census where largest > 45 * 1048576),
    'estimate_bytes', (select round(sum(y.n * coalesce(case when y.m >= 8 then y.avg_b end, o.avg_b))) from y),
    'margin_bytes', round(1.96 * o.sd / nullif(sqrt(o.m), 0) * (select count(*) from printavo_census)),
    'years', (select jsonb_agg(jsonb_build_object('year', yr, 'orders', n, 'measured', m, 'avg_bytes', round(avg_b)) order by yr) from y)
  ) from o;
$$;
