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
