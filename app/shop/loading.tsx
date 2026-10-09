/**
 * Shown the moment a shop link is clicked, while the next page comes from the server (the menu stays put).
 * Without it the old page sat there until the new one was ready, which felt like the click didn't take.
 */
export default function ShopLoading() {
  return <div className="empty" role="status" aria-live="polite">Loading…</div>;
}
