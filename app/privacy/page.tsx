import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy · FBS Print Portal" };

/** Public: the privacy policy Intuit (QuickBooks) and Canva ask apps to link to. */
export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy policy</h1>
      <p className="legal-date">FBS Print portal (portal.fbsprint.com) · Updated October 10, 2026</p>
      <p>This is how FBS Print handles information in its order portal.</p>
      <h2>What we keep</h2>
      <ul>
        <li>Contact details: names, company, email, phone, billing and shipping addresses.</li>
        <li>Orders: products, sizes, quantities, prices, dates, artwork, mockups and approvals.</li>
        <li>Messages: emails and notes about your orders.</li>
        <li>Payments: amounts and dates. Card and bank details are handled by our payment provider; we don&apos;t store them.</li>
      </ul>
      <h2>Why</h2>
      <p>Only to quote, make, ship and bill your orders, keep our accounting in step, and answer you. We don&apos;t sell or rent your information, and we don&apos;t use it for anyone else&apos;s advertising.</p>
      <h2>QuickBooks Online</h2>
      <p>FBS Print keeps its books in QuickBooks Online. When the owner connects it, the portal reads and writes FBS Print&apos;s own customers, invoices and payments so the two agree. The connection uses Intuit&apos;s sign-in (we never see the QuickBooks password), its keys are stored encrypted, and it can be disconnected at any time in the portal&apos;s settings or in QuickBooks.</p>
      <h2>Others who handle it for us</h2>
      <p>Hosting and database (Vercel, Supabase), email, payments, shipping, design (Canva), file storage (Dropbox), garment suppliers for your order, and AI tools that help our staff read emails and prepare orders. Each gets only what its part of the job needs.</p>
      <h2>Keeping it safe, and how long</h2>
      <p>Access is by sign-in, staff see only what their role needs, and connections are encrypted. We keep order and accounting records as long as the business and tax law require.</p>
      <h2>Your choices</h2>
      <p>Ask us to see, correct or delete your information, or to stop emails, at <a href="mailto:nicholas@fbsprint.com">nicholas@fbsprint.com</a>. See also our <Link href="/terms">terms of use</Link>.</p>
    </main>
  );
}
