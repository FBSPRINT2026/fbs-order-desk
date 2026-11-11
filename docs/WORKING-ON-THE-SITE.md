# Working on the site: the handbook for every Claude session

Read this with CLAUDE.md (the house rules) at the start of every session. More than one person changes the site
(Nick and Amanda, each with their own Claude), so the steps below keep their work from colliding.

## The site
- Code: GitHub `FBSPRINT2026/fbs-order-desk`, branch `main`. Next.js app, deployed by Vercel on every push to `main`.
- Live: portal.fbsprint.com. The version under the logo (`lib/version.ts` `APP_VERSION`) says which build is live.
- Database: Supabase project `tmkpbdcqguyzbddrsspr`. Hosting: Vercel project `prj_D2SLUJwYJHPyxhDjSgbdtUfnKI5O`,
  team `team_PNjZDIvDiaLZesJ2hB8OcBoJ` (check a deploy with the Vercel connector's list_deployments, target production).

## Two people at once: the rules
1. **Start every session with the newest code and the news**: `git pull --rebase origin main`, then read
   `tail -30 docs/SHIP-LOG.md` (every change that went live and who shipped it) so you know what the other person did.
   Nick and Amanda can't see each other's chats; the code, this handbook, the ship log and the project notes are what
   both Claudes share. Tell your person in a line if the other one recently changed what they're asking about.
   **Decisions are saved automatically, without being asked**: when Nick or Amanda settles how something should work
   (a rule, a preference, "always do it this way"), write it into CLAUDE.md (a house rule) or this handbook in the same
   ship, with their name and the date, so the other person's Claude follows it too.
   **Only Nick changes the house rules.** CLAUDE.md and this handbook change only on Nick's word. Any other idea for a
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
- Never permanently delete data or files unless asked; database changes are additive migrations.
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
