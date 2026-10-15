-- Going back to an earlier mockup version (Oct 15, Nick: "have the history of edits and be able to go back in time"):
-- each saved mockup keeps the group's garments (style, color) and prints as they were when it was saved.
alter table mockups add column if not exists snapshot jsonb;
