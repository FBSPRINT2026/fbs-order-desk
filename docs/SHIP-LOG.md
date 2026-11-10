# Ship log: every change that went live, who shipped it, newest at the bottom

Written by scripts/ship.sh on every ship. Each Claude reads the last 30 lines at the start of a session
(`tail -30 docs/SHIP-LOG.md`) so it knows what the other person changed. Don't edit old lines.

- Nov 9 · 1.3.207 · Nick · My Day: Test button next to Cheer mode
- Nov 9 · 1.3.208 · Amanda · My Day: Amanda's button next to the Test button
- Nov 9 · 1.3.209 · Nick · Two people shipping safely: ship.sh rebases first; handbook docs/WORKING-ON-THE-SITE.md
- Nov 9 · 1.3.210 · Amanda · My Day: remove the Test button and Amanda's button
- Nov 9 8:46pm · 1.3.211 · Nick · Shared ship log: every ship records who changed what; each Claude reads it at the start and saves decisions to the rules on its own
- Nov 9 8:59pm · 1.3.212 · Nick · Weekly backup to Dropbox: every database table (found by itself, new tables included) copied each Sunday early morning to Dropbox /Portal backups
- Nov 9 9:28pm · 1.3.213 · Nick · Backup reads every table in key order through the database (tables with multi-column keys were read over and over)
- Nov 9 9:37pm · 1.3.214 · Nick · Logo SVG fit: keep each original before saving the fixed file
- Nov 9 10:13pm · 1.3.215 · Nick · Shared screens: the same art at the same spot in another group pays only for screens beyond the ones made (an underbase on a dark shirt), not a whole new set (#40496)
- Nov 9 10:25pm · 1.3.216 · Nick · Same print across groups by default: same logo + spot + size shares screens and the price break, other inks are color changes on their own; picking a logo already on the order brings it in as used; color-change lines list every ink (#40496)
- Nov 9 10:31pm · 1.3.217 · Nick · House rule: the same print across groups (shared screens, price break, color changes)
- Nov 9 10:49pm · 1.3.218 · Nick · Color changes on screen prints are worked out from the print every time (only this group's garment colors), never a stale saved count (#40496 group 2 charged 2 for 1)
- Nov 9 11:02pm · 1.3.219 · Nick · A mockup edited after it was sent but before the customer opened it updates that same proof (same version), instead of waiting as an unsent v2 (#40496)
- Nov 9 11:19pm · 1.3.220 · Nick · Ghost prints and Extras in the + Add garment menu: ghost prints count toward the price break at the print price only, on the invoice, never printed or ordered
- Nov 9 11:24pm · 1.3.221 · Nick · Puff ink: Add underbase / No underbase on the print's puff line (no underbase stays the default)
- Nov 9 11:28pm · 1.3.222 · Nick · Ghost prints line lines up with the garment columns (qty, each, total); puff ink's underbase and Not puff behind a pencil like the screens
- Nov 9 11:32pm · 1.3.223 · Nick · Garment rows: wider Each and Total columns so prices never get cut; ghost prints on one line
- Nov 9 11:38pm · 1.3.224 · Nick · Order garments: price and total columns get room to spare; ghost prints name on the left, note in the middle, one line
- Nov 9 11:44pm · 1.3.225 · Nick · Ghost prints note sits on the same line as the rest
- Nov 10 12:03am · 1.3.226 · Nick · Sending a proof over an approved one: the send screen warns, the old approval comes off on the record, and a replaced version reads 'Replaced (was approved another way)' (#40444)
- Nov 10 12:07am · 1.3.227 · Nick · Every price box shows two decimals (2.40, not 2.4) when you're not typing in it (MoneyField)
- Nov 10 12:07am · 1.3.228 · Nick · House rule: price boxes are MoneyField
- Nov 10 9:48am · 1.3.229 · Nick · Old invoices are paid in the portal: the Pay button no longer opens Printavo's page, for every customer
- Nov 10 9:55am · 1.3.230 · Nick · Customer Payments (shop): check invoices to record a check or ACH, amount fills in; old Printavo invoices included; goes to QuickBooks as one payment
- Nov 10 10:05am · 1.3.231 · Nick · Printavo payments on old invoices show here within minutes: customers who owe on old invoices get their Printavo order list checked about every 15 minutes (read-only)
- Nov 10 10:23am · 1.3.232 · Amanda · Embroidery Thread change suggests Madeira and Isacord threads, not inks (shared threadChoices list)
- Nov 10 10:29am · 1.3.233 · Nick · Job photos on the phone: crop, rotate and pinch-zoom before saving (camera and photos picked from the library)
- Nov 10 10:33am · 1.3.234 · Amanda · Mockup Creator: thread and ink suggestion lists always on the page (they only existed while the Helper panel was open), browser memory off on those boxes
- Nov 10 10:43am · 1.3.235 · Nick · Portal: Pay on any invoice page (new and old Printavo ones) opens the pay window there, with a link to pay several together; every old invoice can be paid in the portal
- Nov 10 10:54am · 1.3.236 · Nick · Old invoices on a phone: each line one card (pictures, item · color, description, size chips, qty × price and total); files with no picture show their type (.AI); status and money never overlap or break
- Nov 10 10:54am · 1.3.237 · Amanda · Work order: print cards never cut off (tighten the page, then smaller card text); garments grouped by colorway under A / B headings with their thread or ink, matching the close-ups and the cards' change rows
- Nov 10 10:59am · 1.3.238 · Amanda · Work order: the Prints column grows to hold all its cards (warnings like NEEDS DIGITIZING never hidden); the page tightens below to make room
- Nov 10 11:01am · 1.3.239 · Nick · Old invoices: no empty art boxes; Pay is a normal button in the top bar
- Nov 10 11:02am · 1.3.240 · Nick · Old invoices on a phone: a line's pictures in a row
- Nov 10 11:38am · 1.3.241 · Amanda · Proof print pages: the art and its measurements always show whole; sized for the panel it's in and scaled to fit when the page squeezes it (thread / ink change versions)
- Nov 10 1:04pm · 1.3.242 · Nick · Printed work orders, quotes, invoices, proofs and job tickets: no browser date, title or link at the top and bottom (page margin 0, each sheet keeps its own border)
- Nov 10 1:13pm · 1.3.243 · Nick · Job Center: a job leaves Goods to order once the garments are ordered, whether through Order goods or added by hand on the order's Goods tab (#40460)
- Nov 10 1:20pm · 1.3.244 · Nick · Order page: Edit mockup shows on every group again (it was hidden on groups with no screen prints, like all-embroidery hats); hidden only when every print is from the customer's own separations (#40466)
- Nov 10 1:31pm · 1.3.245 · Nick · Hats and bags from S&S whose sizes are Adjustable / M/L / OSFM come in as one size (one Qty box, not XS–5XL); thread search in the Mockup Creator and every thread box finds Isacord as well as Madeira (type a number, a name, or 'isacord …')
- Nov 10 1:33pm · 1.3.246 · Nick · Order page: the Printavo panel is gone (no more syncing back to Printavo)
- Nov 10 1:36pm · 1.3.247 · Nick · Embroidery: a Charge sew-out box per print for a customer's own DST ($15 from the price list, its own line on the invoice and in QuickBooks); the Digitizing area tidied: Digitizing then Embroidery extras, every row name, price, tick
- Nov 10 1:37pm · 1.3.248 · Nick · Mockup Creator, embroidery: a ↺ beside each thread, like screen printing's, takes the thread off and splits joined colors back into their own rows
- Nov 10 1:37pm · 1.3.249 · Amanda · Order requests: saving a mockup (or the Mockup Creator's Back) returns to the order instead of asking to open it in the Job Center; once you're working in a request, coming back to it from any tool in that tab doesn't ask again (#50009)
- Nov 10 1:39pm · 1.3.250 · Nick · Customer order page: the print's method and spot never break onto two lines (EMB / SP / HP when the column is narrow); one-size items show one Qty column, not Qty twice
