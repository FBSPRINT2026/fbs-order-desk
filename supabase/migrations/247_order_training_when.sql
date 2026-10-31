-- Create order training: its name and the words that mark a job for it (Oct 30, 2026). Create order offers "make it with the rules".
alter table public.customer_private add column if not exists order_training_name text not null default '';
alter table public.customer_private add column if not exists order_training_when text not null default '';
