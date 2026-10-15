-- which job each customer text is about (Oct 15, Nick: "invoice 27166… a tab that shows emails and texts for this
-- order"): "pv:<archived order id>" (Printavo) or "o:<order id>" (portal). Filed by the job's dates and name, the AI
-- when jobs overlap; job_not = jobs staff said it isn't ("Not this job").
alter table text_messages add column if not exists job_ref text;
alter table text_messages add column if not exists job_how text;
alter table text_messages add column if not exists job_not text[] not null default '{}';
alter table text_messages add column if not exists job_checked_at timestamptz;
create index if not exists text_messages_job_idx on text_messages (job_ref, sent_at);
