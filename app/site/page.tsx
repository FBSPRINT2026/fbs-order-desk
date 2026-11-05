import type { Metadata } from "next";
import { SITE_URL } from "@/lib/config";
import { SERVICES, SITE, STEPS, WHO } from "@/lib/siteContent";
import SiteIconArt, { type SiteIcon } from "@/components/site/SiteIcons";
import SiteRequestForm from "@/components/site/SiteRequestForm";

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
const ICON_ART: Partial<Record<string, string>> = { shirt: "/site/screen-printing.png", cap: "/site/embroidery.png", press: "/site/heat-press.png", swatch: "/site/printing.png", sign: "/site/signage.png", box: "/site/shipping.png" };

export default function SitePage() {
  const login = `${SITE_URL}/login?next=/portal`;
  const tel = `tel:+1${SITE.phone.replace(/\D/g, "")}`;
  return (
    <div className="fws">
      <div className="fws-bar" aria-hidden />
      <header className="fws-head">
        <a className="fws-logo" href="#top" aria-label="FBS Print home"><img src="/brand/fbs-logo.svg" alt="FBS Print" /></a>
        <nav className="fws-nav" aria-label="Site">
          <a href="#services">Services</a><a href="#work">Who we print for</a><a href="#about">About</a><a href="#contact">Contact</a>
        </nav>
        <div className="fws-acts">
          <a className="fws-btn" href={login}>Customer login</a>
          <a className="fws-btn p" href="#request">Start an order</a>
        </div>
      </header>

      <main id="top">
        {/* the old site's squeegee photo behind the headline (Nov 5, Nick: "I like that picture… build that into our header") */}
        <section className="fws-hero">
          <div className="fws-hero-t">
            <p className="fws-kick">Apparel · print · fulfillment</p>
            <h1 className="fws-d">Shirts, hats and print, done right and on time.</h1>
            <p className="fws-lead">Screen printing, embroidery, DTF, signage and promotional products for businesses, breweries, schools and brands, plus wholesale contract printing for decorators. In Richardson, TX since {SITE.since}.</p>
            <div className="fws-row"><a className="fws-btn p lg" href="#request">Start an order or quote</a><a className="fws-btn ghost lg" href={login}>Customer login</a></div>
          </div>
          <div className="fws-hero-pic" aria-hidden />
        </section>

        <section className="fws-portal" aria-label="Customer portal">
          <div><h2 className="fws-d">Already a customer?</h2><p>Approve proofs, reorder past jobs, track your goods and pay invoices in your portal.</p></div>
          <div className="fws-row"><a className="fws-btn" href={login}>Reorder</a><a className="fws-btn p" href={login}>Log in to your portal</a></div>
        </section>

        <section className="fws-sec" id="services">
          <h2 className="fws-h fws-d">What we do</h2>
          <div className="fws-svcs">{SERVICES.map((s) => <div key={s.t} className={`fws-svc ${s.tone}`}><span className="fws-ic">{ICON_ART[s.icon] ? <img src={ICON_ART[s.icon]} alt="" height={64} /> : <SiteIconArt name={s.icon as SiteIcon} />}</span><h3 className="fws-d">{s.t}</h3><p>{s.d}</p></div>)}</div>
        </section>

        <section className="fws-sec fws-alt">
          <h2 className="fws-h fws-d">How ordering works</h2>
          <ol className="fws-steps">{STEPS.map((s) => <li key={s.t}><h3 className="fws-d">{s.t}</h3><p>{s.d}</p></li>)}</ol>
        </section>

        <section className="fws-sec" id="work">
          <h2 className="fws-h fws-d">Who we print for</h2>
          <div className="fws-who">{WHO.map((w) => <div key={w.t} className={`fws-whoc ${w.tone}`}><b className="fws-d">{w.t}</b><span>{w.d}</span></div>)}</div>
        </section>

        <section className="fws-sec fws-alt" id="about">
          <div className="fws-about">
            <div>
              <h2 className="fws-h fws-d">About FBS</h2>
              <p>Since {SITE.since}, FBS has printed and embroidered for Dallas–Fort Worth businesses and for decorators who need a reliable contract shop.</p>
              <p>We keep it simple and repeatable: clear quotes, a proof before anything runs, and a portal where you can see every order, reorder in a couple of clicks and pay online.</p>
            </div>
            <dl className="fws-facts"><div><dt>Since</dt><dd>{SITE.since}</dd></div><div><dt>Quotes</dt><dd>Same day, most days</dd></div><div><dt>Based in</dt><dd>Richardson, TX</dd></div></dl>
          </div>
        </section>

        <section className="fws-sec" id="request">
          <div className="fws-req">
            <div className="fws-req-t">
              <h2 className="fws-h fws-d">Tell us what you need</h2>
              <p className="fws-sub">We&apos;ll send a quote and a proof, usually the same business day. It goes straight to our order desk.</p>
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
        <span className="fws-row"><a href={login}>Customer login</a><a href="#request">Start an order</a><a href="/privacy">Privacy</a></span>
      </footer>
      <div className="fws-bar" aria-hidden />
    </div>
  );
}
