-- Each person's Outlook signature (read from their Sent Items), added to replies sent from the portal.
alter table mail_accounts add column if not exists signature_html text, add column if not exists signature_css text, add column if not exists signature_on boolean not null default true, add column if not exists signature_at timestamptz, add column if not exists signature_checked_at timestamptz;
