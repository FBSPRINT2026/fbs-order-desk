-- Page text translated for the "Translate to Spanish" toggle, kept so each phrase is only translated once.
-- Numbers are left out of the saved text ("{0} jobs" covers "8 jobs" and "9 jobs"). Only the server reads or writes it.
create table if not exists ui_translations (
  lang text not null,
  src text not null,
  dst text not null,
  created_at timestamptz not null default now(),
  primary key (lang, src)
);
alter table ui_translations enable row level security;
