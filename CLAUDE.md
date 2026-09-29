# FBS Order Desk: house rules for changes

- **Toggles remember their setting.** Every toggle, tab, view switch or filter a person sets must stay set after a
  refresh or when they come back (Nicholas, Sep 29 2026). Use `useSticky("area.name", default)` from
  `lib/useSticky.ts` instead of `useState` for these. It saves to this browser's localStorage under `fbs:<key>`.
  Don't use it for data, drafts in progress, pop-ups being open, or search boxes.
- The portal only ever reads from Printavo. Never write, edit or delete anything in Printavo.
- Secrets live in Vercel env vars, added by Nicholas. Never put keys or passwords in code, chat or the database.
- **Spanish toggle.** Every shop and portal page has "Translate to Spanish" at the top right (`components/Translate.tsx`).
  It swaps the page's text in place and saves each phrase's Spanish in `ui_translations`. Put `data-notranslate` on
  anything that must stay exactly as written (codes, a signature, legal text). Inputs, selects and textareas are never touched.
