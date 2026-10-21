-- Neck labels (Oct 20, Nick): we take the manufacturer's tag out and print the customer's own label inside the back
-- neck, one per size (sometimes a set per fabric content: "60% cotton / 40% poly", or a generic one). Kept on the
-- customer as label sets: [{ id, name, content, mode: "per_size" | "template", files: { [size]: file }, template?,
-- sizeBox?, ink, widthIn, note, archived? }]. Files live in storage under proofs/brand-guides/<customer>/neck/.
alter table public.customers add column if not exists neck_labels jsonb not null default '[]'::jsonb;
