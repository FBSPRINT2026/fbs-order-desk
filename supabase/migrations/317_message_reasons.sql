-- What a customer's message is about (Nick, Nov 16 2026: "customer needs to… select like a reason for the message… if they
-- just… add tracking… there's no task associated with that"). question / change / art / payment need an answer; tracking
-- and fyi don't (lib/messages.ts REASONS). Null: an older message, or one written outside the portal (counts as a question).
alter table public.messages add column if not exists reason text;
