import type { Metadata } from "next";
import { SITE_URL } from "@/lib/config";
import { CLIENTS, EVERYONE, FACTS, PORTAL_FEATS, SERVICES, SITE, WHO } from "@/lib/siteContent";
import SiteIconArt, { type SiteIcon } from "@/components/site/SiteIcons";
import SiteRequestForm from "@/components/site/SiteRequestForm";
import SiteLogos from "@/components/site/SiteLogos";

/**
 * fbsprint.com (Nov 5, Nick: "redesign our website so it looks like… our portal"): the portal's look (navy, the blue /
 * salmon / orange bars, Archivo and Public Sans), a way into the portal from every screen, and a request form that lands
 * in the order desk (components/site/SiteRequestForm.tsx). The words are in lib/siteContent.ts. middleware.ts serves
 * this page at fbsprint.com once the domain points here.
 */
export const metadata: Metadata = {
  title: "FBS Print · Screen printing, embroidery and print in Richardson, TX",
  description: "Screen printing, embroidery, DTF transfers, printing, signage and promotional products for businesses, breweries, schools and brands in Dallas–Fort Worth since 2004.",
  robots: { index: true, follow: true },
};

// the product-line drawings Nick picked (public/site); the rest are drawn in components/site/SiteIcons.tsx
const ICON_ART: Partial<Record<string, string>> = { shirt: "/site/screen-printing.png", cap: "/site/embroidery.png", press: "/site/heat-press.png", swatch: "/site/printing.png", sign: "/site/signage.png", box: "/site/shipping.png", store: "/site/online-stores.png" };

export default function SitePage() {
  const login = `${SITE_URL}/login?next=/portal`;
  const tel = `tel:+1${SITE.phone.replace(/\D/g, "")}`;
  return (
    <div className="fws">
      <div className="fws-bar" aria-hidden />
      <header className="fws-head">
        <a className="fws-logo" href="#top" aria-label="FBS Print home"><img src="/brand/fbs-logo.svg" alt="FBS Print" /></a>
        <nav className="fws-nav" aria-label="Site">
          <a href="#services">Services</a><a href="#work">Clients</a><a href="#about">About</a><a href="#contact">Contact</a>
        </nav>
        <div className="fws-acts">
          <a className="fws-btn" href={login}><span className="fws-wide">Customer login</span><span className="fws-narrow">Log in</span></a>
          <a className="fws-btn p fws-wide" href="#request">Get started</a>
          {/* phones: the section links in a menu, so the header is one short line (Nov 5, Nick) */}
          <details className="fws-menu">
            <summary aria-label="Menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></summary>
            <nav aria-label="Site menu"><a href="#services">Services</a><a href="#work">Clients</a><a href="#about">About</a><a href="#contact">Contact</a><a href="#request">Get started</a></nav>
          </details>
        </div>
      </header>

      <main id="top">
        {/* the old site's squeegee photo behind the headline (Nov 5, Nick: "I like that picture… build that into our header") */}
        <section className="fws-hero">
          <div className="fws-hero-t">
            <p className="fws-kick">Apparel · print · fulfillment</p>
            <h1 className="fws-d">Apparel done right, for those who sell it and wear it.</h1>
            <p className="fws-lead">Screen printing, embroidery and DTF for wholesalers, private brands, contract resellers and schools, plus breweries, churches, cities and businesses. 22 years in business, based in North Texas.</p>
            <div className="fws-row"><a className="fws-btn p lg" href="#request">Get started</a><a className="fws-btn ghost lg" href={login}>Customer login</a></div>
          </div>
          <div className="fws-hero-pic" aria-hidden />
        </section>

        <section className="fws-portal" aria-label="Customer portal">
          <div><h2 className="fws-d">Already a customer?</h2><p>Approve proofs, reorder past jobs, track your goods and pay invoices in your portal.</p></div>
          <div className="fws-row"><a className="fws-btn" href={login}>Reorder</a><a className="fws-btn p" href={login}>Log in to your portal</a></div>
        </section>

        <section className="fws-sec" id="services">
          <h2 className="fws-h fws-d">What we do</h2>
          <p className="fws-sub">All done in house, under one roof in North Texas.</p>
          {/* the three main lines big on top, the other four smaller under the color bar (Nov 5, Nick) */}
          {[SERVICES.slice(0, 3), SERVICES.slice(3)].map((row, ri) => (
            <div key={ri} className={`fws-svcs${ri ? " sm" : ""}`}>{row.map((s) => (
              <div key={s.t} className={`fws-svc ${s.tone}`}>
                <span className="fws-ic">{ICON_ART[s.icon] ? <img src={ICON_ART[s.icon]} alt="" height={64} className={s.icon === "shirt" ? "tall" : undefined} /> : <SiteIconArt name={s.icon as SiteIcon} />}</span>
                <h3 className="fws-d">{s.t}</h3><p>{s.d}</p>
                {!ri && <a className="fws-q" href="#request">Get a quote →</a>}
              </div>
            ))}</div>
          ))}
        </section>

        <section className="fws-sec fws-alt" id="work">
          <h2 className="fws-h fws-d">Who we print for</h2>
          <p className="fws-sub">Built for people who sell apparel, and the ones who wear it.</p>
          {/* three even cards, one line and three checks each (Nov 5, Nick: "the top section looks terrible… remake it") */}
          <div className="fws-who">{WHO.map((w) => (
            <div key={w.t} className={`fws-whoc ${w.tone}`}>
              <span className="fws-badge"><SiteIconArt name={w.icon} size={22} /></span>
              <h3 className="fws-d">{w.t}</h3><p>{w.d}</p>
              <ul>{w.points.map((x) => <li key={x}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>{x}</li>)}</ul>
            </div>
          ))}</div>
          <div className="fws-else"><p><b>And everyone else</b><span>{EVERYONE}</span></p><a href="#request">Get a quote →</a></div>
          {/* the brands we print for, one strip that moves on its own and stops under the pointer */}
          <h3 className="fws-logos-t fws-d">Local and national brands we work with</h3>
          <SiteLogos clients={CLIENTS} />
        </section>

        {/* the portal, shown off with the "It's here" email's dashboard picture (Nov 5, Nick: in place of How ordering works) */}
        <section className="fws-sec fws-portal2" id="portal">
          <div className="fws-p2">
            <div>
              <p className="fws-kick">Your own portal</p>
              <h2 className="fws-h fws-d">Every order, in one place.</h2>
              <p className="fws-p2-l">Every FBS client gets their own portal. No chasing emails: see where each job is, and take care of what needs you.</p>
              <div className="fws-p2-f">{PORTAL_FEATS.map(([t, d]) => <div key={t}><b className="fws-d">{t}</b><span>{d}</span></div>)}</div>
              <a className="fws-btn p lg" href={login}>Log in to your portal</a>
            </div>
            <img className="fws-p2-pic" src="/site/portal-dashboard.png" alt="The FBS customer portal: your jobs with their status, and what needs you" loading="lazy" />
          </div>
        </section>
        <div className="fws-bar" aria-hidden />

        <section className="fws-sec fws-alt" id="about">
          <div className="fws-about">
            <div>
              <h2 className="fws-h fws-d">About FBS</h2>
              <p>Since {SITE.since}, FBS has printed and embroidered for Dallas–Fort Worth businesses and for decorators who need a reliable contract shop.</p>
              <p>We keep it simple and repeatable: clear quotes, a proof before anything runs, and a portal where you can see every order, reorder in a couple of clicks and pay online.</p>
            </div>
            <dl className="fws-facts">{FACTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </section>

        <section className="fws-sec" id="request">
          <div className="fws-req">
            <div className="fws-req-t">
              <p className="fws-eyebrow">New client inquiry</p>
              <h2 className="fws-h fws-d">Reach out today</h2>
              <p className="fws-sub">Tell us who you are and what you&apos;re working on. Someone from our team will reach out, usually the same business day, with pricing and next steps.</p>
            </div>
            <SiteRequestForm loginHref={login} />
          </div>
        </section>

        <section className="fws-sec fws-alt" id="contact">
          <h2 className="fws-h fws-d">Contact</h2>
          <div className="fws-contact">
            <div><span className="fws-k">Call</span><a href={tel}>{SITE.phone}</a></div>
            <div><span className="fws-k">Email</span><a href={`mailto:${SITE.email}`}>{SITE.email}</a></div>
            <div><span className="fws-k">Visit</span><a href={`https://maps.google.com/?q=${encodeURIComponent(`FBS Print, ${SITE.address.join(", ")}`)}`} target="_blank" rel="noreferrer">{SITE.address.map((l) => <span key={l}>{l}</span>)}</a></div>
          </div>
        </section>
      </main>

      <footer className="fws-foot">
        <img src="/brand/fbs-logo-white.svg" alt="FBS Print" />
        <span>{SITE.address.join(", ")} · {SITE.phone}</span>
        <span className="fws-row"><a href={login}>Customer login</a><a href="#request">Get started</a><a href="/privacy">Privacy</a></span>
      </footer>
      <div className="fws-bar" aria-hidden />
    </div>
  );
}
