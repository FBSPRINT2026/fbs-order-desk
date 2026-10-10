import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Use · FBS Print Portal" };

/** Public: the end-user license agreement Intuit (QuickBooks) and Canva ask apps to link to. */
export default function Terms() {
  return (
    <main className="legal">
      <h1>Terms of use</h1>
      <p className="legal-date">FBS Print portal (portal.fbsprint.com) · Updated October 10, 2026</p>
      <p>The FBS Print portal is the order system of FBS Print, a screen printing and apparel decorating shop. Our staff use it to run orders, artwork and production; our customers use it to see their orders, approve mockups and art, and pay invoices. By signing in you agree to these terms.</p>
      <h2>Who can use it</h2>
      <p>FBS Print staff, and customers we have invited or who have placed an order with us. Keep your sign-in to yourself; you&apos;re responsible for what is done with it.</p>
      <h2>Your artwork and information</h2>
      <p>You keep the rights to the artwork, logos and files you send us. You tell us you have the right to have them printed, and you let us use them to make your mockups, separations and products. We don&apos;t sell your files or use them for anyone else.</p>
      <h2>Connected services</h2>
      <p>The portal can connect to services FBS Print uses, such as QuickBooks Online (accounting), Canva (design), Dropbox, and our payment and shipping providers. A connection is made only by the FBS Print owner, uses only what the work needs (for QuickBooks: our customers, invoices and payments), and can be disconnected at any time from the portal&apos;s settings or from the other service.</p>
      <h2>Orders and payment</h2>
      <p>Prices, deposits, turnaround and approvals are as shown on each quote, invoice or mockup. An approved mockup is what we print.</p>
      <h2>Availability</h2>
      <p>We work to keep the portal running and your information correct, but it is provided as is, without warranties. FBS Print isn&apos;t liable for indirect losses from using it, to the extent the law allows.</p>
      <h2>Changes and contact</h2>
      <p>We may update these terms; the date above shows the latest version. Questions: <a href="mailto:nicholas@fbsprint.com">nicholas@fbsprint.com</a>. See also our <Link href="/privacy">privacy policy</Link>.</p>
    </main>
  );
}
