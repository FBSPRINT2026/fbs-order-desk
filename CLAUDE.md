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
- **Version number.** `lib/version.ts` `APP_VERSION` (1.1.001, 1.1.002, …) shows small under the logo. Raise it by one
  with every change that goes live (Nicholas, Oct 20 2026), so he can tell after a refresh that the update is there.
- **One look for every shop page** (Nicholas, Oct 21 2026: "every time you rebuild something… you rethink the style…
  we need a common theme… I meant the top of this page [an order]… I liked these toolbars"). The top of the order page
  is the template; never invent a new look:
  - Header: `.page-head` with the `h1` (the color bar comes with it), a one-line `.eyebrow` under it, the page's
    buttons on the right (`.btn`, one `.btn.primary` at most).
  - Numbers: one summary card like the order page's (`.ot-sum` look: the color fade on top, colored labels over each
    number). Build it as `.stats` with `button.stat` cells (`.v` the number, `.k` the label; `.v.alert` for bad news);
    the shop CSS draws it as the summary card. No separate number cards.
  - Tabs and filters: the order page's tab bar (white bar, the picked tab tinted blue with a blue underline, counts in
    little pills). Two kinds, each always the same: the page's sections (full width, like the order page's Order / Art
    & production / Messages…), and a secondary toolbar under them for filters and views inside a section (All / Quotes
    / Completed, Portal messages / Texts…). Build the secondary one as a `.toolbar` with `.chips` of `button.chip`
    (`.on` when picked), with the search and any select on the same row. Never a one-off switch or pill row.
  - Lists: `.tbl-wrap > table.tbl` (small uppercase gray headers, `.ordno` for numbers, `.sub` for a second line only
    when it's needed, `<Pill>` from components/bits for statuses, `.bal` / `.bal.paid` for balances).
  - Panels: `.panel` with `.panel-h` (h2 + a `.faint` note) and `.panel-b`.
  - Type and color: two fonts only. The title font (`--display`, Archivo) for the page `h1` and panel `h2`; the body
    font (`--body`, Public Sans) for everything else, numbers included (no `--mono` except real code). Standard text
    14px `--ink`; sub text (second lines, notes, labels, `.sub` / `.faint` / `small`) 12–12.5px `--ink-3`; bold is
    `--ink` at weight 700; links, the picked tab and counts on it `--accent` / `--fbs-blue`. Money, numbers, dates and
    statuses never wrap onto a second line (`white-space:nowrap`).
  - **Fields (Nick, Oct 22: "lock in the style guidelines")**: every input, picker and dropdown in a form row is the
    kit's field: 36px tall, 6px corners, 1px `--line` border, 14px body font in `--ink`, label above in the small gray
    uppercase label style (only the label, never the value). A picked value (a customer, a style) stays inside the box as
    plain text; never swap the box for a chip, a badge or a different font. Chips that sit in a field row (a garment's
    colors) match the fields: 36px tall, 6px corners. Fields in one row line up at the top and share the same height.
    Pick a customer with `components/CustomerPick.tsx` (type to find), never a `<select>` of customers.
  - No new colors, radii, font sizes or shadows: use the CSS variables (`--ink*`, `--line*`, `--surface*`, `--accent*`,
    `--fbs-*`, `--warn`, `--danger`, `--ok`, `--r`). When a page needs something the kit doesn't have, add it to the kit
    in `app/globals.css` (the "One look across the shop" block) and use it everywhere.
