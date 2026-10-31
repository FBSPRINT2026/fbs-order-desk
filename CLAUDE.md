# FBS Order Desk: house rules for changes

- **Permanent solutions, never patches (the first rule; Nick, Oct 28 2026: "this is a system we're gonna use for five
  years, maybe more… we want really good permanent solutions that fix the problems, not 'we found a way to do this one
  order right'… when you fix a problem, you've gotta be fixing it so that it figures out 10 other problems").**
  - **Fix the kind of problem, not the case.** Before changing anything, find the root cause and name the whole family of
    problems it belongs to: "it read a total row as an order line", not "McKenna's extras"; "it didn't see shirts drawn
    in a file", not "LYL 102326.ai". The fix has to handle every member of that family, including ones nobody has hit yet.
  - **No special-case rules.** Never key behavior on one customer, one file name, one form layout or one order (no "if the
    name says mockup", no "McKenna's third row"). Use general abilities instead:
    - look at the actual content the way a person would;
    - check the result against the source itself: every total on the paperwork is accounted for, sizes add up, and the
      art fits the shirt;
    - learn from what staff correct, so a saved before-and-after from a real job guides the next similar one.
  - **Systems that learn over special cases.** When the shop teaches something (a correction, a returned DST, a fixed
    order), it should be kept and used automatically next time, for everyone, without anyone ticking "remember".
  - **Leave it better than one fix.** When you meet a special-case rule from before, replace it with the general one in
    the same change.
  - **Prove it on more than the one case.** Before calling it fixed, try it on the order it was found on and on other
    real past jobs of the same kind (other customers, other files), and say what they showed.
  - **Say what it covers.** When you tell Nick it's fixed, name the family of problems the fix covers and what else it
    will now catch, not just the order it was found on.

- **Toggles remember their setting.** Every toggle, tab, view switch or filter a person sets must stay set after a
  refresh or when they come back (Nicholas, Sep 29 2026). Use `useSticky("area.name", default)` from
  `lib/useSticky.ts` instead of `useState` for these. It saves to this browser's localStorage under `fbs:<key>`.
  Don't use it for data, drafts in progress, pop-ups being open, or search boxes.
  In the customer portal, choices reset to the defaults after an hour away (Nick, Oct 24 2026); `useSticky` does this itself.
- The portal only ever reads from Printavo. Never write, edit or delete anything in Printavo. The only exceptions are
  the staff-pressed buttons for 40,000-series orders during the move, each behind its own guard in `lib/printavo.ts`:
  Send to Printavo, Add mockups & art, Resync details, and Reset in Printavo (Nick, Oct 27 2026: clears that order's
  lines, fees and files in Printavo and sends ours again; `transitionReset`). Never run them yourself.
- Secrets live in Vercel env vars, added by Nicholas. Never put keys or passwords in code, chat or the database.
- **Spanish toggle.** Every shop page has "Translate to Spanish" at the top right (not the customer portal: removed Oct 15 2026, Nicholas) (`components/Translate.tsx`).
  It swaps the page's text in place and saves each phrase's Spanish in `ui_translations`. Put `data-notranslate` on
  anything that must stay exactly as written (codes, a signature, legal text). Inputs, selects and textareas are never touched.
- **Toolbars never scroll sideways** (Nicholas, Oct 15 2026). A row of tabs or buttons must fit: when it doesn't, the
  buttons show icons only, then the row wraps. `components/ToolbarFit.tsx` does this for `.aa-nav`, `.ot-nav`,
  `.ibx2-tabs`, `.mf-bar` and anything with `data-toolbar`; give new toolbars icons and one of those hooks.
- **Nothing scrolls sideways, tables included** (Nick, Oct 30 2026: "remove the horizontal scroll bars… by default, we
  don't want that anywhere on the site, so you would never build that"). A table fits its panel: text cells wrap (money,
  numbers, dates and statuses stay on one line), cells tighten on narrower screens (`table.tbl` has no min-width), and a
  column that's only sometimes needed is hidden behind a small button that adds it back (the Payroll Center's
  "+ Add bonus"), or two values share a cell on two lines. Never fix a too-wide table with a scroll bar.
- **Tables are fitted for you** (Nick, Oct 30 2026: "we've literally talked about this like 25 times… why can't you just
  write a rule so this doesn't happen again?"). `components/TableFit.tsx`, mounted for every page, measures every table:
  when it's wider than its box or a cell is narrower than a word in it (a side panel squeezing the page, a phone), the
  table becomes stacked rows with each column's name in front, and goes back when there's room. Don't build a
  table-only phone layout or a sideways scroll; put `data-nofit` only on a table that must never stack.
- **Every feature's class names are its own** (Oct 31: the Assistant's to-do cards were squeezed and stacked because
  the Inbox's after-send pop-up and the Artwork shelf also defined `.as-card` / `.as-t` in the global stylesheet). Give a
  new feature its own prefix, grep `app/globals.css` for a name before using it, and run `node scripts/css-clashes.mjs`
  after adding styles: it lists names two features both define.
- **Nothing gets squished** (Nick, Oct 30 2026: "same thing here… keeps writing that way. Can we not do that moving
  forward?", a name wrapping one word per line under a line item, an account # box squeezed to a sliver). Before
  shipping any new piece of a page, look at it in the narrowest place it shows (the order page's side panels, a phone):
  text never wraps a word per line, a row added under a grid line spans the full width (`grid-column:1/-1`), and fields
  keep a readable width (`minmax(…)` / wrap the row, never fixed pixel columns that crush the middle one). A short form
  (a few fields and a button) sits on one line when there's room.
- **Each AI tool is ONE tool, used in many places** (Nicholas, Oct 23 2026: "think of each of these as an individual
  tool that just gets applied multiple places in the site… the create order is in email, it's in the ClickUp thing, it's
  in the projects area… one uniform tool that works throughout the site"). Every AI tool is listed in `lib/aiTools.ts`
  (shown in AI Workbench → Tools) with the component that IS the tool and the places it opens from. A button for a tool
  anywhere opens that component (Create order = `components/tools/CreateOrderTool.tsx`); never copy or fork a tool's flow
  into a page. Fix or change it in the tool, and add a new place to its `places` list.
  **When a tool gets a new version, every way into the old one opens the new one in the same change** (Nick, Oct 27:
  Order goods from an invoice still opened the old page after the new right-side panel was built for email). Search for
  the old component, its page route and links to it (`/shop/order-goods?order=`, to-dos, alerts, Ask AI menus) and
  point them all at the one tool; an old page left for another use opens the tool when it's given a link's params.
- **Fix it everywhere, once** (Nick, Oct 28 2026: "I have to tell you everywhere when there's a problem that's
  universal… you just fix it in one spot at a time… what do I need to tell you so that you fix it everywhere?"). When
  something is wrong in one place, it's wrong everywhere the same thing is shown or worked out: search the whole app for
  every place that draws or computes it (grep the component, the field, the helper) and fix them all in the same
  change. If they don't already share one piece, make one and point every place at it, so it can't drift again:
  - a logo's small picture anywhere: `components/LogoThumb.tsx` (never a bare `<img>` of a logo's preview);
    an order print's logo: `PrintThumb` from the same file (its inks on its garment's color);
  - a garment's color anywhere (tiles, swatches, close-ups, printed pages): `lineColor(line)` from `lib/mockup.ts` (the
    color picked in the Mockup Creator, else the color the mockup drew it in (`shade`, saved with each mockup), else its name), passed to `guessHex` / `shirtBg` / LogoThumb (Nick, Oct 29: "the
    boxes… permanently fix this problem throughout the site");
  - an ink's screen color: `colorHex` from `lib/inkColors.ts` (the Ink Room's stocked inks are loaded for every shop page
    by the shop layout, `components/StockInkSeed.tsx`, and for the printed pages by `app/print/[id]/page.tsx`);
  - a group's saved mockup pictures: `lib/mockupFresh.ts` (`mockupHref` for every link into a group's mockup, so a logo
    mockup opens the logo builder; the save stamps `mockupArt`, and the order page redraws stale pictures by itself;
    anything that swaps a group's pictures for others clears `mockupArt`);
  - the thread on each needle of a stitch file (its picture, chips, sew sequence, work order, sew-out): `needleThreads` /
    `stopColors` in `lib/needleThreads.ts` (a worksheet that only names colors, "8 Dark Blue", is needle 8 in a color, not
    a thread or a PMS: the order's thread nearest that color goes on it);
  - where an embroidered print is in digitizing: `digitizeState` / `digitizeStamp` in `lib/digitizeStatus.ts` (the
    Digitizing page's tabs and the order's print stamps).
  When you tell Nick it's fixed, say where else it was fixed.
- **Order reader rules.** When you change the email/PO order reader's rules (`lib/ai/emailOrder.ts`), raise `READER_REV`
  there, or Create order keeps reusing readings saved with the old rules (Oct 24 2026).
- **One PMS matching fee per PMS color per order** (Nick, Oct 24 2026: "if you have a same color on the front and the
  back, like the same PMS… you only have one PMS matching fee"). The same PMS (matched by its number: "PMS 230 C" = "230C")
  on several prints or groups of one order is charged once, on its first print. `calcGroup` / `calcOrder` in
  `lib/pricing.ts` do this through the shared `seen` set; any new pricing path must go through them.
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
