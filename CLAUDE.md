# FBS Order Desk: house rules for changes

- **Toggles remember their setting.** Every toggle, tab, view switch or filter a person sets must stay set after a
  refresh or when they come back (Nicholas, Sep 29 2026). Use `useSticky("area.name", default)` from
  `lib/useSticky.ts` instead of `useState` for these. It saves to this browser's localStorage under `fbs:<key>`.
  Don't use it for data, drafts in progress, pop-ups being open, or search boxes.
- The portal only ever reads from Printavo. Never write, edit or delete anything in Printavo.
- Secrets live in Vercel env vars, added by Nicholas. Never put keys or passwords in code, chat or the database.
- **Spanish toggle.** Every shop page has "Translate to Spanish" at the top right (not the customer portal: removed Oct 15 2026, Nicholas) (`components/Translate.tsx`).
  It swaps the page's text in place and saves each phrase's Spanish in `ui_translations`. Put `data-notranslate` on
  anything that must stay exactly as written (codes, a signature, legal text). Inputs, selects and textareas are never touched.
- **Toolbars never scroll sideways** (Nicholas, Oct 15 2026). A row of tabs or buttons must fit: when it doesn't, the
  buttons show icons only, then the row wraps. `components/ToolbarFit.tsx` does this for `.aa-nav`, `.ot-nav`,
  `.ibx2-tabs`, `.mf-bar` and anything with `data-toolbar`; give new toolbars icons and one of those hooks. Tables and
  calendars may still scroll.
