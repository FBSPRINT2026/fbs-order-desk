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
