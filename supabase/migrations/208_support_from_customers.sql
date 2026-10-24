-- customers report problems too (Oct 24, Nick); saved by the server for them.
alter table support_issues add column if not exists source text not null default 'staff';
alter table support_issues add column if not exists customer_id uuid;
alter table support_issues add column if not exists customer_name text not null default '';
