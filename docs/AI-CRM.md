# AI + CRM in the Order Desk

The order desk is being built so AI can help with every part of the job: reading customer emails, filling in orders, catching mistakes, and reminding the shop who needs a follow-up. This file explains what's in place, how to turn it on, and where to add more.

**The rule everywhere:** AI drafts and suggests; people decide. Nothing the AI produces changes an order, sends a message or charges a card until someone on staff clicks.

## What works today (no AI needed)

**Assistant** (`/shop/assistant`, in the side menu with a badge). A follow-up engine (`lib/crm/followups.ts`) looks across orders, proofs, payments and messages and lists what needs a nudge:

| Follow-up | When it shows up |
|---|---|
| Customer waiting on a reply | Last message on a thread is from the customer (urgent after the "reply" hours setting) |
| Order request to price | Customer sent in a request and it hasn't been priced |
| Quote follow-up | Quote sent, no answer after N days (urgent when the in-hands date is close) |
| Quote never sent | A priced draft quote sitting for 2+ days |
| Proof changes requested | Customer asked for changes and no new proof has been uploaded |
| Proof waiting on customer | Proofs pending for N days |
| Payment overdue | Balance past the due date from the customer's payment terms |
| No deposit yet | Approved "due on receipt" job with nothing paid |
| Past / at risk of missing the in-hands date | Job not finished and the date is here or close |
| Waiting for pickup | Ready for N days |
| Scheduled follow-up | The customer's "Next follow-up" date has arrived |
| Annual reorder | They ordered about a year ago and haven't this year |
| Check in | No order in N days |

Each item has **Draft message** (a ready-to-send message from `lib/crm/templates.ts`), **Send to customer** (posts in their portal thread and emails them), **Done**, **Snooze** and **Dismiss**. Decisions are saved in `ai_suggestions` by a stable key, so a dismissed item stays gone until the situation changes (for example, a quote sent again is a new follow-up). Staff can also add their own **to-dos** with a reminder date.

The rules' timings are in **Pricing & shop → Assistant & AI**. The Orders page shows a one-line summary of today's follow-ups.

**CRM on the customer page:** next follow-up date, account owner, tags, last contact (kept up to date automatically from messages and logged activity), and a **Timeline** where staff log calls, notes, meetings and pasted emails. The customer list can filter by tag or "follow-up due".

**On the order form:** an **Order check** panel (missing dates, ink counts that don't match colors, $0 lines, shipping without an address, tax-exempt customer being taxed, production before proofs are approved…), the customer's terms, tags, notes and other balances on the customer card, **Quick replies** in the message box, and **Calls & notes** for the order.

**Customer order form (portal):** customers can choose pickup / ship / delivery with an address and add their PO number. Any past order has **Order this again**, which copies it into a new request they can change and send in.

## Turning on AI

1. In the [Claude Console](https://console.anthropic.com), create an API key (set a monthly spend limit there too).
2. In Vercel → Project → Settings → Environment Variables add `ANTHROPIC_API_KEY`, then redeploy.
3. In the app, **Pricing & shop → Assistant & AI**, tick **Use AI**, and choose what it may do:
   - **Read incoming customer emails**: sorts each email, drafts a reply, and when it's an order, proposes one you can turn into a quote in one click.
   - **Let customers describe an order in their own words** (portal): the AI fills in their order form for them to check. Limited to 10 tries per customer per hour.

With AI on, these buttons start working: **✦ Rewrite with AI** on any Assistant draft, **✦ Fill from an email** and **✦ AI review** on the order form, and pasted emails on a customer's timeline get read automatically. `/api/health` shows whether the key is set.

Models (changeable in settings): Claude Sonnet 5 for drafting and reading orders, Claude Haiku 4.5 for sorting emails.

Every AI call is logged in the `ai_runs` table (task, model, tokens, time, errors) so you can see cost and quality. No blank costs or production notes are ever sent to the customer side; the AI is told never to invent prices or promise dates.

## Getting emails in

Emails land on the customer timeline (`activities`), matched to a customer by the sender's address and to an order by a `#1234` in the subject.

- **By hand, today:** Assistant → **Paste an email**, or **+ Paste an email** on a customer's timeline.
- **Automatically:** set `INBOUND_EMAIL_SECRET` in Vercel (any long random string), then point an inbound-email service at
  `https://portal.fbsprint.com/api/inbound/email?key=YOUR_SECRET`.
  It accepts Brevo Inbound Parsing webhooks directly, or simple JSON `{ from, subject, text, message_id }` from Zapier/Make (e.g. a Gmail or Outlook "new email" trigger), or a Cloudflare Email Worker.

## Daily run

`vercel.json` schedules `/api/cron/assistant` every day at 12:00 UTC (7am Central in summer, 6am in winter). Add `CRON_SECRET` in Vercel (any long random string) to enable it. It reads any emails the AI hasn't read yet (when AI and email reading are on) and, if **Email me a daily follow-up list** is ticked, emails the shop the day's list.

## Database

Migrations `020_ai_crm_foundation.sql` and `021_customer_private.sql` (already applied):

- `activities`: the customer timeline (email in/out, call, note, meeting, task, text). `external_id` stops the same email being stored twice.
- `ai_suggestions`: the Assistant inbox. `source` is `rules`, `ai` or `staff`; `status` is open / snoozed / done / dismissed; `draft` holds a ready message; `payload` holds data such as proposed order groups.
- `ai_runs`: the AI call log.
- `customer_private`: staff-only customer fields: internal `notes`, `tags`, `next_follow_up`, `owner_email`, `last_contact_at` (kept fresh by a trigger on messages and activities). These used to sit on `customers`, which customers can read for their own account; internal notes were moved here so customers can never see them.

All staff-only through row-level security.

## Code map

| File | What it does |
|---|---|
| `lib/crm/followups.ts` | The follow-up rules (pure functions, shared by the page, nav badge, digest) |
| `lib/crm/templates.ts` | Message templates used by follow-ups and quick replies |
| `lib/crm/private.ts` | Merges staff-only customer fields onto customers, and splits them back out on save |
| `lib/crm/inbound.ts` | Stores an email on the timeline and matches customer and order |
| `lib/orderChecks.ts` | Rule checks for the order form |
| `lib/ai/claude.ts` | The one place that calls the Claude API (on/off switch, structured answers, logging) |
| `lib/ai/tasks.ts` | The AI jobs: order from text, draft a message, review an order, sort an email |
| `lib/ai/normalize.ts` | Turns AI answers into real order groups, defensively |
| `lib/ai/email.ts` | Reads one stored email and leaves suggestions |
| `app/shop/ai-actions.ts` | Staff server actions for all of the above |
| `app/shop/assistant/page.tsx` | The Assistant page |
| `app/api/inbound/email`, `app/api/cron/assistant` | Email webhook and daily run |

## Next steps (roadmap)

1. **Connect the inbox** (Brevo inbound or a Gmail/Outlook forward) so every customer email lands on the timeline.
2. **Log outgoing email** to the timeline too (portal messages already count as contact).
3. **Quote builder from email end to end:** match styles to the S&S catalog and pull costs automatically when the AI's proposal is turned into a quote.
4. **Proof review:** have the AI compare the approved proof with the order (colors, locations, sizes) before it goes to press.
5. **Customer summaries:** a one-paragraph "what you should know" on each customer page, built from their timeline and orders.
6. **Staff roles:** give production, receiving and shipping their own Assistant lists (the `staff.role` column is already there).
7. **Two-way SMS** for pickup reminders (the `sms` activity kind is reserved for it).
