# FBS Order Desk: house rules for changes

**More than one person works on this site (Nick and Amanda). Read `docs/WORKING-ON-THE-SITE.md` first: start from the
newest code, ship small and often with `SHIP_BY=<Nick or Amanda> bash scripts/ship.sh "what changed"`, read `tail -30 docs/SHIP-LOG.md` to see what the other person changed, never force-push.**
**Only Nick changes these rules and the handbook. Anyone else's idea for a rule goes in `docs/SUGGESTIONS.md` for him to
decide; never re-suggest what's under its "Not doing" (Nick, Nov 11 2026).**

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

- **Toggles remember their setting, for a while.** Every toggle, tab, view switch or filter a person sets must stay set after a
  refresh or when they come back soon (Nicholas, Sep 29 2026); a page not visited for 2 hours goes back to its defaults
  (All, every status) (Nick, Nov 3 2026: "if you haven't gone back to a page in a while, it should reset to all"). The
  left menu's own settings (`nav.*` keys) are kept. Use `useSticky("area.name", default)` from
  `lib/useSticky.ts` instead of `useState` for these. It saves to this browser's localStorage under `fbs:<key>`.
  Don't use it for data, drafts in progress, pop-ups being open, or search boxes.
  In the customer portal nothing is remembered: leave a screen and come back and its tabs and filters are the defaults
  again (Nick, Nov 2 2026: "it should just go back to all"); `useSticky` does this itself.
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
  Columns never run into each other (Nick, Nov 10 2026): don't give a column a fixed width its contents can outgrow
  ("Nov 11 · tomorrow" in a 96px Due column); TableFit also lays out by contents any `table-layout:fixed` table whose
  cell spills into the next column (`tbl-fitcols`).
- **A side panel squeezes the page like a narrower window** (Nick, Nov 3: "when you scale down the job center… it looks
  good but when you create an order in that panel comes up… it acts completely different"). `components/DockFit.tsx`,
  mounted for every page, moves every `(max-width/min-width)` rule by the open panel's width (`.dla-bg.dock`), so the
  page lays out for the room it really has. Keep writing width rules as usual; a layout that lives in a box of its own
  (a list in a panel) uses a container query (`container: name / inline-size`, as `.pjr-list` does), never the window.
- **Pop-ups never open off the page** (Nick, Nov 12: "if you're at the bottom of the browser and you right-click… it
  doesn't pop up off the page"). `components/PopFit.tsx`, mounted for every page like TableFit, moves anything that floats
  over the page (`position: fixed` placed by top/left: right-click menus, dropdowns, popovers) back inside the window, up
  from the bottom and in from the right, and one taller than the window scrolls inside. Place a menu at the pointer as
  usual; put `data-nopopfit` only on one that must stay exactly where it's put.
- **Dragging scrolls with you** (Nick, Nov 12: "as you're dragging it, use your scroll wheel… it's not working smooth").
  `components/DragScroll.tsx`, mounted for every page: while anything is dragged, the wheel scrolls the page (or the box
  under the pointer) smoothly, and holding near the top or bottom edge scrolls that way. Never build a drag-only scroll.
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
  **It's also measured on every page** (Nick, Nov 1: "I've had to tell you this… 20 times, maybe 30… write it in the
  rules"): `components/SquishFit.tsx`, mounted for every page like TableFit, finds text narrower than its own longest
  word that runs 3+ lines and gives it its own full-width line in its row. It's a safety net, not the design: a row in a
  side panel (Create order, Create reorder, the AI order helper, a dock) is built stacked from the start (picture beside a
  column of name, then the field under it; never three columns side by side), and a switch of 3+ options in a panel is
  a one-line segmented bar with short words (`grid-template-columns:repeat(n,minmax(0,1fr))`), never chips that wrap.
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
    An EMB alone is a digitized logo (`lib/embFile.ts` reads its size, stitches, stops, threads and TrueView picture;
    Nick, Nov 10 2026): the print says "DST needed" until embroidery adds the DST on the logo, which confirms that file.
  When you tell Nick it's fixed, say where else it was fixed.
- **Lists over 1,000 rows are read in pages** (Oct 31: the database answers at most 1,000 rows per request whatever
  `.limit()` says, so the Time page's pay period, a mail folder, the dashboard's Printavo jobs and SanMar's styles were
  quietly cut at 1,000). Any read that can pass 1,000 rows goes through `readAll` / `allRows` from `lib/readAll.ts`
  with a fixed order (end with `.order("id")`). Run `node scripts/big-reads.mjs` after adding a query: it lists any
  `.limit()` over 1,000 that isn't paged, and any growing table (orders, customers, logos, mockups, payments, messages…)
  read whole in one go (Nov 1: logos grow 100+ a week; the shop's order list, the order page's customer list and the
  Artwork page all read whole tables).
- **Order reader rules.** When you change the email/PO order reader's rules (`lib/ai/emailOrder.ts`), raise `READER_REV`
  there, or Create order keeps reusing readings saved with the old rules (Oct 24 2026).
- **One PMS matching fee per PMS color per order** (Nick, Oct 24 2026: "if you have a same color on the front and the
  back, like the same PMS… you only have one PMS matching fee"). The same PMS (matched by its number: "PMS 230 C" = "230C")
  on several prints or groups of one order is charged once, on its first print. `calcGroup` / `calcOrder` in
  `lib/pricing.ts` do this through the shared `seen` set; any new pricing path must go through them.
- **The same print across groups** (Nick, Nov 9 2026, #40496: "as long as you have the same artwork across a job… quantity
  discounts can apply across different groups… if there's a different color, I just do a color change"). The same logo at
  the same spot and size (`printSizeKey`) in several groups of one order is one print: one set of screens (a group that
  needs more, an underbase on a dark shirt, pays only for those), its pieces counted together for the price break, and
  each ink printed differently charged as a color change without anyone ticking it (`calcOrder` in `lib/pricing.ts`; a
  color change set by hand, `Imprint.changeOf`, wins). Another size is its own print. Picking a logo already on the order
  in the Mockup Creator brings it in the way it's used there (`swapLogo`), and the print says "Same print as …" or warns
  about the size.
  Prints set as a color change of one another by hand (`changeOf`) are the same print too: one set of screens however many
  groups use them, and their pieces counted together for the price break.
- **A program's screen price is for every screen** (Nick, Nov 10 2026: Tiger Blue "always pays $15 per screen new or
  remake"): `screenFeeOf` in `lib/pricing.ts`; a remake fee never overrides it.
  A program can also charge a print's youth screens but price youth and adult pieces together at the group's break
  (`RateCard.youthTogether`, Tiger Blue; Nick, Nov 10 2026: "he gets the qty discount… but pays for the screens").
- **A reseller's end clients are separate customers to the order reader** (Nick, Nov 10 2026: "anytime I use the order
  helper and it detects Nine18, it thinks everything is All My Sons"). Nine18 orders for All My Sons, Armstrong, New City
  Moving…: a job only gets the rules, worked examples, brand logos and program rate card of the end client it names
  (`trainingsForText`, `loadExamples`' same-client check, `logosOnFile(…, jobText)` / `namesBrand`, `cardForOrder`'s match
  words). A job for an end client with nothing on file is read from scratch, never as the customer's biggest client.
  **"No" to the rules question means from scratch** (Nick, Nov 10 2026: "it doesn't know who it is, it doesn't know
  what it is"): on the Create order card, while "This looks like a … order" is asked and after "No, use the card",
  everything the card makes is read as a new customer's job (`SCRATCH` / `isScratch` in `lib/emailOrderShared.ts`): no
  trainings, examples, memories, logos, past-job matching, learned styles or file guesses, standard or master mockups,
  training defaults, program pricing or confirmed specs. Only rules or a past job staff pick by hand still count. New
  customer knowledge in the reader or Create order goes behind `knowId` / `scratch` too.
- **Names on pieces are the line's personalization** (Nick, Nov 10 2026: the order helper "is not using the add
  personalization tool"). Anything that makes or changes an order puts names on `GLine.persList` (what "Add
  personalization" makes, charged per name) through `persFromNames` in `lib/persNames.ts`: the order reader and the AI
  order helper's line field `personalization`. Never in a print's notes or a line note. The helper's free edits are
  checked against `lib/orderShape.ts` (every key the order's types have, kept in step by the compiler): a made-up field
  is refused, never saved where nothing reads it. Add a new order field to the type and the compiler sends you there.
- **A customer's own separations** (Tiger Blue sends seps with every order; Nick, Nov 11 2026: "this is how we're going
  to put these orders in moving forward"). When a customer sends their own separations, the order is made the way the
  Create order card picks it: their mockup picture is the visual mockup (`customerMockups`, "Visual mockup · theirs,
  printed from their films"), their separation file (the .ai) goes on each print as Customer separations
  (`custSeps.films`), and the color count and inks come off their order form and mockup. A PSD or other extra file they
  send is reference only. Never build a Mockup Creator logo from their files or swap the card's pick for their art file
  (that read #50030's front as 1 white color and put the PSD on the back).
  Their work order (Nick, Nov 12, #40382): page 1 as always, then their mockup as big as the page goes with each print's
  inks as a line under it, and no press sheets (nothing to show but black boxes): `theirSeps` in `WorkOrderDoc`.
  Their films print as one plate (Nick, Nov 12: only the crop marks came out): every spot color in a PDF/.ai film is put
  on every plate (`filmAsOnePlate` in `lib/filmFix.ts`, run by Print in Their separations), so the art prints solid black.
- **Underbase** (Nick, Nov 11 2026: "that's the rule"): every shirt gets a white underbase under the colors except a white
  or very pale one (cream, ivory, natural: `paleShirt` in `lib/separate.ts`), unless the print says no underbase (the
  order's underbase switch, `Imprint.underbase === false`, or a fashion hit). A coach lesson about "light shirts" means
  those pale ones only. Underbase and print order go by the ink's real color (`printShade`), not the color the art is
  drawn in; one-color art prints as the one ink its print names.
- **What a garment is, for timing** (Nick, Nov 12, #50036's sweatshirts timed as tees): `garmentKind` in `lib/production.ts`
  reads the line's words (plurals and "sweatshirt"/"crewneck" included), and when they say nothing, the style number's
  catalog name (our garments, then SanMar: `seedStyleTitles`, loaded by the schedule and Production settings).
- **Headwear spots** (Nick, Nov 10 2026): beanies sew on the Front (never the cuff); caps on the Full Front (All My Sons'
  logo at 4.21" wide). `BEANIE_LOCATIONS` / `HAT_LOCATIONS` in `lib/pricing.ts`.
- **A sent version isn't locked until the customer answers** (Nick, Nov 10 2026: "until it's approved or declined, it
  wouldn't really lock"). Changing a group's mockup while its version is out and unanswered updates that same version
  (`refreshUnseenProofs` in `app/shop/proof-actions.ts`), opened or not; a new version only starts once they've approved
  or asked for changes. Anything that swaps a group's mockup pictures calls it.
- **Samples** (Nick, Nov 11 2026: "two types of an order that has a pre-production sample… anything goes type of thing"):
  one Sample tool, `components/tools/SampleRunTool.tsx` (`lib/samples.ts`), from Create order's card (+ Sample), the
  order's Order type → New order with sample, Production ▾ → Sample run, and a sample group's Edit (Nick, Nov 11: like a
  mixed job busted out by kind, the sample is busted out of the same job: a "Sample · …" and a "Production run · …" card). Order + sample: the sample is its own group at
  the top (`Group.sample`, kind "pre": its pieces picked from the order's lines, `GLine.sampleOf`), its pieces off the top
  (the run prints that many fewer, never ordered or counted twice: `runParts` / `goodsGroups`), extra from the customer,
  or extra blanks; its own "Sample" card on the schedule (`production_slots.sample`), and the full run says "Waits for
  sample OK" and runs no earlier than the day after it. Order type Sample (Create order's Sample only) is only the type: its own
  pricing, a "Sample" tag for production, no sample groups; Production ▾ → Make the order
  starts the real order from it, linked both ways (`orders.from_sample` / `GroupSample.made`). Charges are rows of a name
  and an amount, never a rule; a charge ticked "Credit on the full run" comes off the real order (the same order for a
  pre-production sample, a Sample credit fee on the order made from a sample only one). Planned → Pulled → Printed → Approved.
- **Production holder** (Nick, Nov 10 2026; replaced Hold the spot): saving press time for a quote before its art is in
  is `components/tools/ProductionHolder.tsx`, opened from the order's Production ▾ menu; a held spot shows as a small
  dashed "Held · <day>" tag in the order's header (no big button). It reads the order (each garment's pieces, kind and
  darkness: `QuickJob.parts`) and guesses the spots and colors (the order's prints, else its art files' names, else the
  customer's recent orders); staff only fix what's off. Orders from the same email can be held together.
- **Money in is one tool: Receive a Payment** (Nick, Nov 11 2026; it was Take a Payment): `components/tools/ReceivePaymentTool.tsx`
  at `/shop/receive-payment` (the old `/shop/take-payment` address opens it). One search (customer, invoice # or PO),
  the customer's invoices grouped by how late when there are many, quick picks and "Pay an amount" (oldest first),
  then Run a card (cards they OK'd, a new card, fee, PIN) or a payment made elsewhere recorded straight on with nothing
  charged (`recordLumpPayment`): Card · already paid (a Stax link, Square), Check, ACH, Cash, Venmo / Zelle. Two panes
  (Nick, Nov 11): today's numbers and Received today by customer on the left; the customer card, invoices and how they
  paid on the right, or who's waiting on payment when nobody's picked (`waitingOnPayment`);
  old Printavo invoices can be paid by check here. Every "take / record a payment" button opens it.
- **Sending to a customer is one Send** (Nick, Nov 10 2026): every Send button opens `components/tools/SendProofTool.tsx`
  with the proof (when there's a new version) and the quote both ticked; staff untick one to send the other alone. Never
  a quote-only or proof-only send path.
- **Order statuses** (Nick, Nov 11 2026): … Approved → In Production → Fulfillment (printed; finishing, counting, packing) →
  Ready → Completed. Ready is worded by the order's delivery method: Ready for Pickup / Ready to Ship / Ready to Deliver
  (`readyLabel` / `statusText` in `lib/pricing.ts`; `<Pill ship={o.delivery_method}>`). Any "open work" status list
  includes fulfillment (`IN_WORK_STATUSES`).
  Canceled (an invoice called off) is stored like a Closed Quote: status `completed` with `declined_at`, type invoice
  (`isCanceled` / `statusKey` → "canceled"), so every finished-job filter skips it; it never goes to QuickBooks live.
- **Goods & Receiving opens on its dashboard** (Nick, Nov 11 2026, option E; `app/shop/receiving/ReceivingDash.tsx`): the jobs
  to count in, by the day each runs on the press (Today / Tomorrow / Next day / Later, working days; not on the schedule
  yet is Later; a goods problem stays on Today), under a full-width All / Screen print / Embroidery / Heat press switch, Count in opens the Check-In counter; a counted job grays out under its day and is listed under ✓ Counted until
  the press starts it, then it drops off; a job the press started that was never counted stays on Today as "On the press ·
  not counted" (Nick, Nov 12, #50036). Issues to work under the list; S&S and SanMar trucks (today / next day) on the right.
  Its top: a Dashboard button (box icon) beside the Shipments tabs (Arriving & tracking, FBS orders, Customer supplied,
  Ignored); Settings in the header. Two blocks: Counting (a Schedule | Due date switch for the days; All/SP/EMB/HP with the
  search beside it; Today / Tomorrow / Next day / Later / ✓ Counted) and Receiving (trucks).
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
    A price box is `components/MoneyField.tsx` (two decimals, 2.40 not 2.4, when not being typed in; Nick, Nov 10 2026),
    never a bare `<input type="number" step="0.01">`.
  - No new colors, radii, font sizes or shadows: use the CSS variables (`--ink*`, `--line*`, `--surface*`, `--accent*`,
    `--fbs-*`, `--warn`, `--danger`, `--ok`, `--r`). When a page needs something the kit doesn't have, add it to the kit
    in `app/globals.css` (the "One look across the shop" block) and use it everywhere.
- **The schedule's look** (Nick, Nov 11 2026: "too busy… a key at the top"): every job on a press is a white card, one color
  all round (no colored edge; Nick, Nov 11: "let the dots and stuff do the talking"); only late (bold red number, no tag; Nick, Nov 11) and holds (dashed, "Hold" tag) look different. Overtime
  is a soft amber band behind the hours, warm-up and lunch plain gray; no shade over the past: the whole day shows from the first crew in, live clock on or off, and how it's going is on the jobs (Nick, Nov 12, option C): one dark header card per press (name, crew, clock-in, the press, then a bar: "2 of 4 done · on pace" / "35m behind" / "20m ahead", `dayScore`: only from what's been marked, the last job marked done against its planned finish or a printing job's updated pieces; a start that went by counts only with the live clock on; nothing marked, no pace is claimed), done jobs grayed and dashed with the number struck through and the time, the printing job a green border with how far, a job whose start went by "Not started" in red (`dayState`). A phone gets the read-only day view (Done / Running / Next / Waiting / Late start per press); the key sits under the schedule's search on the
  right (Goods / Printing / On the board; Hide folds it to one line, remembered: `.mky`, Nick Nov 12). Time lost to someone not clocked in yet (`Down` flagged "clock" in
  `withClock`) keeps work off but draws no Down box. Holds are jobs like any other: they wait in Ready To Schedule (its
  tabs: All / Late / Holds / On time) and move in a re-plan; a hold's booking carries `hold_id` (`ownerCols`).
  Jobs back to back show as one group only when they're one run: the same artwork and the same in-hands date (`oneRun`;
  Nick, Nov 11: same customer alone is never a group).
  An order's production date is the day it runs (Nine18's weekly AMS run; Nick, Nov 11): Re-plan and Ready To Schedule
  put it on that day or later, never earlier (`Job.prod`).
  Sending a crew home at 40 hours (Re-plan, Cut unused overtime) never makes their day shorter than the morning: the
  earliest they go home is lunch (Nick, Nov 11). A job that won't finish today never starts with under an hour left in the day
  (`DAY_TAIL`): it starts the next morning. A hold (Production holder) runs no earlier than 3 working days before its
  in-hands date; it saves press time near its date, it never jumps the line (Nick, Nov 11).
  **Left click is information, right click is doing** (Nick, Nov 12). Left click opens the job card (`CardPanel`):
  status, due, goods, lock; mockup pictures; run time (press, planned, started, so far); each print with its inks; the
  garments by style number and color ("1717 Sage") and who counted them; every mockup on the order in a grid of four;
  inks without "PMS"; Open job, Separations, Mockup, Work order, and Split (pick the print spots that run separately and
  the press for them: `splitByLocation`) or, on a split job, Unite (`uniteJob`: back into one run on the first run's
  press); More details (in-hands date, run times, labor, the log). Nothing on it starts, finishes or moves a job. Right click (option B): the run as three steps
  (Started → Printing → Done, each with its time); one row of the time box, Pause (or Resume) and Complete; under it
  "When it's done, the order goes to" Fulfillment / Ready (picked to start with) / Completed; Pause asks why (Lunch, Break,
  Ink, End of day, Other) and what's done so far, spot by spot (Done / Part with pieces / Not yet), which sets how much is
  left (`pauseDone`, each spot weighed by its print time); then Goods tiles (Count in, All here, Missing), Schedule tiles (Run next, Move, Lock), Rush / Firm, and Take off the
  schedule (asks once).
  Right-click a job does by hand what the press timer and time clock do (Nick, Nov 12: "he should be able to do with a right
  click what the live clock will do"), each with a time box (now, changeable): Mark started, pieces done so far, Pause
  (Lunch / Break / Ink / screen / Other), Resume, Mark complete (then the order goes to Fulfillment / Ready / Completed
  once it's its last job on the schedule), Not started after all, Not done yet. All through `logAction`, the same booking
  fields and job log the press timer writes. Lock… opens a side panel with the four locks (`rcDo`, `lockSide`).
  A printing job shows it against the time it was figured to take (Nick, Nov 12, option A; `runState`): a strip across
  the bottom, green "Printing" while on time (no finish time), yellow "Printing · 12m over" up to 30 minutes over, red past that, with time used / figured
  (lunch it ran through doesn't count); a job too short for a strip gets just "Printing" at the end of its line.
  Rush and Firm are small words at the right end of a job's first line, never emoji or a second-line tag (Nick, Nov 12);
  no dot after a printing job's number.
  A job marked complete sits where it really ran, from its start to its finish, and later work stays after it; it
  stays on the schedule grayed, even after its order moves to Fulfillment, Ready or Completed (Nick,
  Nov 12: "it doesn't go away… we still want to see it there"); only bookings not yet done leave when the order moves on.
  A started job runs until it's marked complete: past its planned finish it stretches to now and the jobs after it move
  down, live clock on or off (Nick, Nov 12). The tiny shirt before a job's number is its goods (`GoodsTee`, the digits' exact height on their baseline; green
  counted, amber here not counted, red a problem or not counted and runs within a day, orange not here yet; in the key too), from the latest count first, then the
  order's goods status.
  Its Goods section (Nick, Nov 12) shows the job's count (Not counted / ✓ Counted / Problem) with Count in, All here
  (every size saved as received) and Missing… (the counter), saved the same as Goods & Receiving's counts.
  Right-click a job: Run next (first on its press after what's running), or lock it to its spot (fixed), its person (any
  press they run), its press, or its day; Re-plan moves a job only within its lock (Nick, Nov 11). A job locked to its spot
  never moves: the other jobs flow around it, finishing before it or starting after it. Nothing new is booked into time
  that's already past today, whatever the Live clock. Start over asks first: Keep my locks or Release all locks too. Downtime is a solid gray block (no stripes); lunch and warm-up are a lightly tinted band with the word centered
  ("Lunch 30 min"; the warm-up after lunch is part of its band, no times); a lunch that falls inside a job is counted in
  the job and drawn as the same tinted band across its card (Nick, Nov 11). Shift held before or after grabbing a job
  pins it. Shift + drag pins a job to the exact quarter hour it's dropped at (locked to its spot);
  everything else grays out while it's dragged.
  **Lunch comes from the time clock** (Nick, Nov 12: "if the press operator clocks out… that marks their lunch"): when a
  press's operator clocks out and back in, that time is off the press (`Machine.away`, from `withClock`), live clock on or
  off: it pauses whatever was printing (the job grows by it) and shows as a striped band inside the job ("Lunch · Miguel
  out 11:30–12:04 · 34m", under 15 minutes "Break"); still out, it runs to now. Once they've taken a lunch that way, the
  planned lunch for that day is dropped (`breaksOn`). Only the operator's own punches count.
  **Live clock** (Nick, Nov 11 2026; `ProductionSettings.liveClock`, the switch in the schedule's Press & crew tools): off
  (the default while the floor learns to clock in), the schedule is a plan made by hand like Printavo's: no time lost to
  someone not clocked in, nothing not started is pushed up to now, unfinished days don't roll to today, punching onto a
  job doesn't start it. On, all of that follows the time clock and press timers. Either way, each press line shows when its crew clocked in at
  its right end ("In 6:12a", "In 7:21a · late", "Not in yet"; display only), and the press under its name ("Gauntlet III ·
  12 color", `pressSpec` from its name and colors). Anything new that reacts to punches
  goes behind it.
