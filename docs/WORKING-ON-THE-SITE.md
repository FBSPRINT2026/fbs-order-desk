# Working on the site: the handbook for every Claude session

Read this with CLAUDE.md (the house rules) at the start of every session. More than one person changes the site
(Nick and Amanda, each with their own Claude), so the steps below keep their work from colliding.

## The site
- Code: GitHub `FBSPRINT2026/fbs-order-desk`, branch `main`. Next.js app, deployed by Vercel on every push to `main`.
- Live: portal.fbsprint.com. The version under the logo (`lib/version.ts` `APP_VERSION`) says which build is live.
- Database: Supabase project `tmkpbdcqguyzbddrsspr`. Hosting: Vercel project `prj_D2SLUJwYJHPyxhDjSgbdtUfnKI5O`,
  team `team_PNjZDIvDiaLZesJ2hB8OcBoJ` (check a deploy with the Vercel connector's list_deployments, target production).

## Amanda's Claude can change the site (Nick, Nov 16 2026)
Amanda changes the site the same way Nick does: any page, any feature, billing and payments included. Read this
handbook and CLAUDE.md, make the change, typecheck, and ship it with `SHIP_BY=Amanda`. Don't ask Nick first and don't
tell Amanda it can't be done. The only things off limits are the catastrophic ones under "Never, whoever asks" below
(deleting data or tables, wiping or rewriting `main`, secrets) and the house rules files themselves (see rule 1).
**If your session doesn't have the code** (you can't find this handbook or CLAUDE.md): attach the GitHub repo
`FBSPRINT2026/fbs-order-desk` to the session and clone it, then read this file. If GitHub refuses, Amanda's claude.ai
account needs GitHub connected (Settings → Connectors) with access to that repo; tell her that in one line.

## Two people at once: the rules
1. **Start every session with the newest code and the news**: `git pull --rebase origin main`, then read
   `tail -30 docs/SHIP-LOG.md` (every change that went live and who shipped it) so you know what the other person did.
   Nick and Amanda can't see each other's chats; the code, this handbook, the ship log and the project notes are what
   both Claudes share. Tell your person in a line if the other one recently changed what they're asking about.
   **Decisions are saved automatically, without being asked**: when Nick or Amanda settles how something should work
   (a rule, a preference, "always do it this way"), write it into CLAUDE.md (a house rule) or this handbook in the same
   ship, with their name and the date, so the other person's Claude follows it too.
   **Only Nick changes the house rules.** This is about the rules files only, never about the site: Amanda changes any
   page or feature herself. CLAUDE.md and this handbook change only on Nick's word. Any other idea for a
   rule or a handbook change, Amanda's included, goes in `docs/SUGGESTIONS.md` under "Waiting for Nick", and that's
   it: don't edit the rules, don't keep reminding Amanda or Nick, and never bring back anything listed under
   "Not doing" (Nick, Nov 11 2026). Nick's Claude: when Nick asks what's suggested, read it to him; do what he approves,
   then move it to Done or Not doing.
2. **Small changes, shipped often.** One fix or feature per ship. Long-running unshipped work is what collides.
3. **Ship only with `SHIP_BY=<Nick or Amanda> bash scripts/ship.sh "what changed"`** (SHIP_BY = whose change it is;
   it goes in the ship log). It brings in the other person's latest work first, numbers
   the version after the newest one, and pushes. If both of you changed the same lines it stops and lists the files:
   merge them (keep both people's intent), then ship again. Never force-push. Never reset or rewrite `main`.
4. **Say what you're working on.** If Nick is on the schedule page, Amanda's Claude works elsewhere, or after his ship.
5. **After shipping**, wait for the Vercel deploy to be READY (about 3–4 minutes) and look at the change on the live site.
6. **Typecheck before shipping**: `npx tsc --noEmit -p .`. There are about 311 old known errors; don't add new ones in the
   files you touched (`npx tsc --noEmit -p . 2>&1 | grep <your file>`).
7. CSS: give a new feature its own class prefix and run `node scripts/css-clashes.mjs`. Big reads: `node scripts/big-reads.mjs`.

## Never, whoever asks (Nick's standing rules)
- Never write, edit or delete anything in Printavo. Never press the staff 40,000-series Printavo buttons.
- Never enter, print or store passwords, API keys or tokens (they live in Vercel env vars Nick adds). Never repeat card numbers.
- Never send customers emails or texts, pay suppliers, or place supplier orders unless Nick asks in the chat.
- Never permanently delete data or files unless asked; database changes are additive migrations (never drop or empty a table).
- Never delete anything in QuickBooks.
- Nick and the staff edit orders live: the order page autosaves and can overwrite a direct database write to an open order.
- In checks on the live site, don't click Create / Make the order / Send, and don't make real data.
- If a tool is refused, stop and ask; don't work around it.

## How Nick likes to work
- "Show me" means a mockup first; build only after "build it".
- Short replies, plain words, no internal jargon. Say what changed and where else it was fixed.
- Follow CLAUDE.md: general fixes not special cases, fix it everywhere, one tool used everywhere, one look, nothing
  squished or scrolling sideways, `useSticky` for toggles, `readAll` for big lists, raise the version with every ship.

## Handy
- The cloud machine can't reach portal.fbsprint.com directly. To call a portal route (one-time jobs), use Supabase
  `net.http_get(url:=…, headers:=jsonb_build_object('x-sync-token',(select token from printavo_sync where id=1)::text))`
  then read `net._http_response`. Never print the token.
- Project notes (decisions, restore points, what was built when) are in the claude.ai project "FBS Portal Build and
  Implementation" (shared with the team). Check them before redoing something.
