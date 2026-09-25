# FBS Order Desk

Shop management and customer portal for FBS Print. It's a private replacement for Printavo.

**Shop side (`/shop`)**
- Quotes and invoices with a size run for each line (XS–5XL) and decorations per location (screen print by ink colors, embroidery, DTF)
- Auto-pricing from the quantity-break price matrix, blank markup, big-size upcharges, and setup fees (screens and digitizing)
- Production board (drag and drop) and a due-date calendar
- Customers, payments and order history
- Artwork proof uploads, messages with customers, and sending quotes to customers
- Printable quote/invoice (Print or save as PDF)

**Customer portal (`/portal`)**
- Sign-in by email link or 6-digit code, with no password
- Each customer sees only their own orders, never drafts or production notes
- Quote approval with a typed signature, or a change request
- Approve or reject each artwork proof, with comments
- Pay the deposit or full balance by card (Stripe Checkout)
- Message the shop about an order, with email alerts both ways
- Order progress tracker and printable invoice

**Stack:** Next.js 15, Supabase (Postgres, Auth, Storage, row-level security), Stripe Checkout, Brevo (or Resend) email, hosted on Vercel.

See **SETUP.md** for step-by-step setup.

## Layout
- `supabase/schema.sql`: tables, security rules and storage bucket
- `lib/pricing.ts`: the one pricing engine used everywhere (editor, portal, Stripe amounts)
- `app/shop/*`: staff pages; `app/shop/actions.ts`: send to customer, proof requests, staff messages
- `app/portal/*`: customer pages; `app/portal/actions.ts`: approvals, proofs, messages, checkout
- `app/api/stripe/webhook`: records card payments
- `app/print/[id]`: printable quote/invoice

## Security model
Customers only read through their own session, so row-level security limits them to orders linked to their email that have been sent. Everything a customer changes goes through server actions. Those check ownership first and then write with the service key. Staff are the emails listed in the `staff` table.
