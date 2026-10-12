-- a to-do can link to what it's about (the Job watcher: the job, Order goods, Receiving)
alter table public.tasks add column if not exists url text;
