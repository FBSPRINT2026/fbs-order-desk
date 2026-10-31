import Link from "next/link";

/**
 * A list row that opens a page is a real link (Oct 31, Nick: "in Printavo… when you are in the orders screen, you can
 * right click and open in a new tab. But here you can't do that"): put this first in the row's first cell and give the
 * row `className="rl"`. The link covers the whole row (app/globals.css "Rows that open a page"), so a click opens the
 * page, and right-click Open in new tab, middle-click and Ctrl/Cmd-click work like any link. Buttons, checkboxes and other
 * links in the row sit above it and keep working. `off` (a row picking for a bulk action) leaves the row as it is.
 */
export default function RowLink({ href, label, off }: { href: string; label?: string; off?: boolean }) {
  if (off || !href) return null;
  return <Link href={href} className="rl-a" prefetch={false} aria-label={label || "Open"} />;
}
