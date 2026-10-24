-- a mockup the customer (or shop) archived (Oct 24, Nick: "you need to be able to archive… archive should be like a toggle on
-- the top"): still theirs, shown under Archive. archived_at stays for replaced versions (saved again), which never show.
alter table mockups add column if not exists shelved_at timestamptz;
