# FBS Order Desk: setup guide

This gets your shop app and customer portal running at your own web address, for example `portal.fbsprint.com`. Plan on about an hour the first time. Everything below uses free plans, except that Stripe charges its normal fee on each card payment.

You'll create five accounts. Keep a notes file open, because you'll copy a few keys from one site to another.

| Service | What it does | Cost |
|---|---|---|
| GitHub | Stores the code | Free |
| Supabase | Database, logins, proof file storage | Free plan |
| Vercel | Runs the website | Free (Hobby) plan |
| Stripe | Card payments | Per-payment fee only |
| Resend | Sends emails (login codes, alerts) | Free up to 3,000/month |

---

## 1. Put the code on GitHub

1. Sign up at **github.com** if you don't have an account.
2. Click **+** (top right) → **New repository**. Name it `fbs-order-desk`, choose **Private**, and click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Unzip `fbs-order-desk.zip` on your computer. Open the unzipped folder, select **everything inside it** (including the `app`, `lib`, `components` and `supabase` folders), and drag it all onto the GitHub page.
5. Click **Commit changes**.

## 2. Set up Supabase (database and logins)

1. Sign up at **supabase.com** → **New project**. Name it `fbs-order-desk`, create a strong database password (save it), and pick the region closest to you (for example US East).
2. Wait about 2 minutes for the project to finish setting up.
3. **Create the tables:** in the left menu, open **SQL Editor** → **New query**. Open `supabase/schema.sql` from the zip in a text editor, copy all of it, and paste it in.
   - Near the bottom, check the line with `nicholas@fbsprint.com`. That email gets shop access. Change it if you'll sign in with a different address.
   - Click **Run**. You should see "Success. No rows returned."
4. **Get your keys:** go to **Project Settings → API Keys** (the Project URL may be under **Data API**). Copy these three into your notes:
   - **Project URL** (looks like `https://abcd1234.supabase.co`) → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key, called **Publishable key** on newer dashboards → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key, called **Secret key** on newer dashboards (click Reveal) → `SUPABASE_SERVICE_ROLE_KEY`. Keep this one secret, because it has full access to the database.

Come back to Supabase in step 6 to finish the login settings.

## 3. Set up Resend (email)

Supabase's built-in email only sends a few messages per hour, which isn't enough for customers signing in. Resend fixes that and also sends your order alerts.

1. Sign up at **resend.com** → **Domains** → **Add domain** → `fbsprint.com`.
2. Resend shows a few DNS records. Add them wherever your domain's DNS is managed. If your domain is connected through Wix, that's Wix → **Domains** → **Manage DNS records**. Wait until Resend shows the domain as **Verified**. This can take anywhere from a few minutes to a few hours.
3. Go to **API Keys** → **Create API key** (Full access). Copy it → this is `RESEND_API_KEY`.
4. **Connect Resend to Supabase logins:** in Supabase, go to **Authentication → Emails → SMTP Settings** (on older dashboards: **Project Settings → Authentication**) and turn on **Enable custom SMTP**. Enter:
   - Sender email: `orders@fbsprint.com`, sender name: `FBS Print`
   - Host: `smtp.resend.com`, Port: `465`
   - Username: `resend`, Password: your Resend API key
   - Save.

## 4. Set up Stripe (card payments)

1. Sign up at **stripe.com**. Leave **Test mode** turned on for now, so you can try everything with fake cards.
2. Go to **Developers → API keys** and copy the **Secret key** (starts with `sk_test_`). This is `STRIPE_SECRET_KEY`.
3. You'll add the webhook in step 6, after the site has an address.

## 5. Put the site online with Vercel

1. Sign up at **vercel.com** using **Continue with GitHub**.
2. Click **Add New → Project** and **Import** the `fbs-order-desk` repository.
3. Open **Environment Variables** and add each of these (name on the left, value on the right):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from step 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
| `NEXT_PUBLIC_SITE_URL` | `https://portal.fbsprint.com` (or the `.vercel.app` address for now, no slash at the end) |
| `STRIPE_SECRET_KEY` | from step 4 |
| `STRIPE_WEBHOOK_SECRET` | leave out for now, you'll add it in step 6 |
| `RESEND_API_KEY` | from step 3 |
| `EMAIL_FROM` | `FBS Print <orders@fbsprint.com>` |
| `SHOP_NOTIFY_EMAIL` | the inbox that should get alerts, e.g. `nicholas@fbsprint.com` |

4. Click **Deploy**. When it finishes you'll get an address like `fbs-order-desk.vercel.app`.
5. **Use your own address (recommended):** in Vercel, go to **Project → Settings → Domains** and add `portal.fbsprint.com`. Vercel shows a **CNAME** record. Add it at your DNS provider (the same place as step 3). Once it shows **Valid**, set `NEXT_PUBLIC_SITE_URL` to `https://portal.fbsprint.com` and **Redeploy** (Deployments → ⋯ → Redeploy).

## 6. Finish the connections

**Supabase login settings**
1. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://portal.fbsprint.com` (your address)
   - **Redirect URLs:** add `https://portal.fbsprint.com/**`
2. Go to **Authentication → Emails → Templates**. Replace both the **Magic Link** template and the **Confirm signup** template with the text below. This makes the login link work even when a customer opens the email on a different phone or computer, and it also shows a 6-digit code.

Subject: `Your FBS Print sign-in code`

```html
<h2>Sign in to FBS Print</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">Click here to sign in</a></p>
<p>Or enter this code: <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

**Stripe webhook** (records online payments on the order)
1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://portal.fbsprint.com/api/stripe/webhook`
3. Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Save, then click **Reveal** under **Signing secret** (starts with `whsec_`). Add it in Vercel as `STRIPE_WEBHOOK_SECRET` and **Redeploy**.

## 7. Test it end to end

1. Go to your site and sign in with your shop email. You'll land on the **shop side**.
2. Open **Pricing & shop** and enter your real prices, shop name, phone, terms and deposit %. Click **Save changes**.
3. Under **Customers**, add a test customer using a **personal email** you can check, such as a Gmail address.
4. Create a quote for that customer and click **Send quote to customer**.
5. On your phone, open the email and sign in. You'll see the **customer portal**. Approve the quote with your name.
6. Back on the shop side, set the order to **Art & Proofs**, upload a mockup and click **Ask customer to approve**. Approve it from your phone.
7. On your phone, pay the deposit using Stripe's test card `4242 4242 4242 4242`, any future date and any CVC. The payment should appear on the order within a few seconds.
8. Send a message from each side and check that the email alerts arrive.

**Tip:** on any customer's page, **View their portal** shows you exactly what they see.

## 8. Go live

1. In Stripe, finish account activation (bank details), then turn **Test mode** off.
2. Copy the **live** secret key (starts with `sk_live_`) into Vercel's `STRIPE_SECRET_KEY`.
3. Create the webhook again in live mode (step 6) and update `STRIPE_WEBHOOK_SECRET`.
4. Redeploy in Vercel.
5. On your Wix site, add a **Customer login** button that links to `https://portal.fbsprint.com`.

## Day-to-day notes

- **Adding staff:** go to **Pricing & shop → Shop staff** and add their email. They sign in the same way customers do.
- **Customer logins:** customers sign in with the email on their customer record. If someone says they "can't see their order," check that email for typos. Customers only see orders you've sent, never drafts, and never your production notes.
- **Changing the code later:** edit files on GitHub, or have Claude make the changes. Vercel redeploys automatically on every change.
- **Backups:** Supabase's free plan doesn't include automatic backups you can restore. Upgrade to Pro ($25/month) once you're running real orders through it.
