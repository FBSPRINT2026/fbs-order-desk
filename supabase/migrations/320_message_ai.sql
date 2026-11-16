-- The AI reads each customer message with its order (Nick, Nov 16 2026: "an AI function on our side… would you like me
-- to update the shipping address to this?"). ai: what it read and what it offers (lib/ai/messageRead.ts); ai_kind:
-- "todo" (something to change or answer, whatever reason the customer picked: "firm ship date, bag size… those are
-- changes") or "filed" (nothing to do); handled_at: done (applied, answered or filed), off To do.
alter table public.messages add column if not exists ai jsonb;
alter table public.messages add column if not exists ai_kind text;
alter table public.messages add column if not exists handled_at timestamptz;
alter table public.messages add column if not exists handled_by text;
create index if not exists messages_ai_pending on public.messages (created_at) where author_type = 'customer' and ai is null and handled_at is null;
