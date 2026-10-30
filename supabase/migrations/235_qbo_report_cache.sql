-- QuickBooks reports kept for a short while (Oct 30, 2026, Nick: "use these real numbers now for the statistics on My
-- Day"): the Profit and Loss by month, read through the portal's own QuickBooks connection and kept here for an hour so
-- every page load doesn't ask Intuit. Row security on, no policies: only the server reads and writes it.
create table if not exists public.qbo_report_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.qbo_report_cache enable row level security;
