-- the customer's choice (Oct 24, Nick): off = our messages stay in their portal's message center, no email.
alter table customers add column if not exists message_email boolean not null default true;
