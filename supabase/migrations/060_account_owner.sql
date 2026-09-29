-- Who owns (handles) a customer account, by name from Settings → Staff → Account owners. Staff-only.
alter table public.customer_private add column if not exists account_owner text not null default '';
