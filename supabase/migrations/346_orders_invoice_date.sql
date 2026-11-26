-- An invoice's own date (Nick, Nov 26 2026: "you got to be able to go back in time and make an invoice"): blank = the day
-- it was finished (completed_at); set, it's the invoice's date everywhere: terms count from it (payDueDate), the printed
-- invoice, statements and QuickBooks' TxnDate.
alter table orders add column if not exists invoice_date date;
