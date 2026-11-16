/**
 * What a crew phone shows the instant a page is asked for, while the server gets it ready (Nick, Nov 16 2026: "it's
 * really slow to load the main screen so people think it's not working"): the header and a moving bar, in both languages.
 */
export default function CrewLoading() {
  return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /></header>
      <main className="jm-main crl" aria-busy="true">
        <div className="crl-bar" aria-hidden><i /></div>
        <p className="crl-t">Loading… · Cargando…</p>
        <div className="crl-card" aria-hidden />
        <div className="crl-card short" aria-hidden />
      </main>
    </div>
  );
}
