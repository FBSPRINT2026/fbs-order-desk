-- Cheer mode (Oct 12, Nick: Amanda loves a little praise): fireworks and a kind note when you finish something. On for Amanda.
alter table public.staff add column if not exists cheer boolean not null default false;
update public.staff set cheer = true where lower(email) = 'amanda@fbsprint.com';
