/**
 * Shown the moment a portal link is clicked, while the next page comes from the server (Oct 24, Nick: "the customer
 * portal is slow… it just kind of spins for a second, doesn't do anything"): the header stays, this shows at once.
 */
export default function PortalLoading() {
  return (
    <main className="p-main p-loading" role="status" aria-live="polite" aria-label="Loading">
      <div className="p-sk p-sk-h" />
      <div className="p-sk-row"><div className="p-sk p-sk-card" /><div className="p-sk p-sk-card sm" /></div>
      <div className="p-sk p-sk-card wide" />
    </main>
  );
}
