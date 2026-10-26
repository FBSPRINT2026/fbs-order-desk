"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Settings, regrouped (Oct 24, Nick: "We've added so much stuff… everything all mixed together. I don't like pages where
 * they have a toolbar at the top and you click it and it scrolls down… let's just make it tabs… connections should have
 * QuickBooks and Canva underneath it"). Seven tabs, each its own page (its own link, nothing scrolls); a group with
 * several parts gets a second row of buttons under the tabs. Each tab opens the part you were last on.
 */
type Group = { k: string; label: string; icon: ReactNode; subs: [string, string][] };
const I = (d: string) => <svg viewBox="0 0 24 24" aria-hidden className="ot-ic"><path d={d} /></svg>;
export const SETTINGS_GROUPS: Group[] = [
  { k: "shop", label: "Shop", icon: I("M3 10l9-6 9 6v10H3z"), subs: [["/shop/settings/shop", "Shop info"], ["/shop/settings/launch-email", "Portal launch email"]] },
  { k: "pricing", label: "Pricing", icon: I("M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"), subs: [["/shop/settings/pricing/retail", "Retail"], ["/shop/settings/pricing/wholesale", "Wholesale"], ["/shop/settings/pricing/addons", "Add-ons"], ["/shop/settings/pricing/payments", "Tax & payments"]] },
  { k: "garments", label: "Garments", icon: I("M8 4l-4 3 2 4 2-1v10h8V10l2 1 2-4-4-3c-1 2-3 2-4 2s-3 0-4-2z"), subs: [["/shop/catalog", "Garment catalog"], ["/shop/settings/garments/popular", "Popular garments"]] },
  { k: "production", label: "Production", icon: I("M3 7h18v10H3zM7 7V4h10v3"), subs: [["/shop/settings/production", "Machines & crews"], ["/shop/settings/production/times", "Run times"], ["/shop/settings/production/speed", "Real speed"]] },
  { k: "people", label: "People", icon: I("M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M21 20c0-2-1-4-4-5"), subs: [["/shop/settings/people/staff", "Staff"], ["/shop/settings/access", "User access"], ["/shop/settings/people/owners", "Account owners"]] },
  { k: "assistant", label: "Assistant & AI", icon: I("M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"), subs: [["/shop/settings/assistant", "Assistant & AI"]] },
  { k: "connections", label: "Connections", icon: I("M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8"), subs: [["/shop/settings/quickbooks", "QuickBooks"], ["/shop/settings/canva", "Canva"], ["/shop/settings/dropbox", "Dropbox"], ["/shop/settings/texts", "Texts (Mac)"], ["/shop/customers/import", "Printavo"], ["/shop/settings/status", "Status"]] },
];
const LAST = "fbs:settings.last";
const read = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
export const groupOf = (path: string) => SETTINGS_GROUPS.find((g) => g.subs.some(([h]) => h === path)) || null;
/** where Settings opens: the page you were last on */
export const lastSettingsPage = () => read(LAST) || "/shop/settings/shop";

export default function SettingsTabs() {
  const path = usePathname();
  const cur = groupOf(path);
  const [last, setLast] = useState<Record<string, string>>({});
  useEffect(() => {
    // remember this page, for this tab and for Settings as a whole
    if (cur) { write(`${LAST}.${cur.k}`, path); write(LAST, path); }
    setLast(Object.fromEntries(SETTINGS_GROUPS.map((g) => [g.k, read(`${LAST}.${g.k}`)])));
  }, [path, cur]);
  return (
    <>
      <nav className="aa-nav ot-nav set-nav" aria-label="Settings">
        {SETTINGS_GROUPS.map((g) => {
          const href = (last[g.k] && g.subs.some(([h]) => h === last[g.k]) ? last[g.k] : g.subs[0][0]);
          return <Link key={g.k} href={href} className={"aa-tab" + (cur?.k === g.k ? " on" : "")} aria-current={cur?.k === g.k ? "page" : undefined} title={g.label}>{g.icon}<span className="ot-l">{g.label}</span></Link>;
        })}
      </nav>
      {cur && cur.subs.length > 1 && (
        <div className="toolbar set-sub" data-toolbar>
          <div className="chips">{cur.subs.map(([h, l]) => <Link key={h} href={h} className={"chip" + (h === path ? " on" : "")}>{l}</Link>)}</div>
        </div>
      )}
    </>
  );
}

/** a Settings page's header: the tab's name, one line under it, the page's buttons on the right */
export function SettingsHead({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1><div className="eyebrow">{note}</div></div>{children ? <div className="row">{children}</div> : null}</div>;
}

type Check = { ok: boolean; detail: string };
/** Live status of the outside services (Printavo, Stax, Claude). Never shows keys. */
export function ConnectionsPanel() {
  const [res, setRes] = useState<Record<string, Check> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); fetch("/api/health/apis", { cache: "no-store" }).then((r) => r.json()).then(setRes).catch(() => setRes(null)).finally(() => setBusy(false)); };
  useEffect(run, []);
  const rows: [string, string, string][] = [
    ["printavo", "Printavo", "PRINTAVO_EMAIL and PRINTAVO_TOKEN (Printavo → My Account → API token; Premium plan)"],
    ["stax", "Stax payments", "STAX_API_KEY and STAX_WEB_PAYMENTS_TOKEN (Stax Pay → Apps → API Keys)"],
    ["claude", "Claude (AI)", "ANTHROPIC_API_KEY (console.anthropic.com → Settings → API Keys)"],
    ["sanmar", "SanMar (product data)", "SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME and SANMAR_PASSWORD (a SanMar.com user made for web services)"],
    ["sanmar_ftp", "SanMar FTP (catalog files)", "SANMAR_SFTP_USERNAME and SANMAR_SFTP_PASSWORD (from SanMar's one-time link)"],
  ];
  return (
    <section className="panel" id="connections">
      <div className="panel-h"><h2>Status</h2><span className="faint">Is each outside service working</span><button type="button" className="btn sm" onClick={run} disabled={busy}>{busy ? "Checking…" : "Check again"}</button></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        {rows.map(([k, label, how]) => {
          const c = res?.[k];
          return (
            <div key={k} className="conn-row">
              <span className={"conn-dot" + (c ? (c.ok ? " ok" : " bad") : "")} aria-hidden="true" />
              <div><b>{label}</b><div className="faint" style={{ fontSize: 12.5 }}>{c ? c.detail : busy ? "Checking…" : "Couldn't check"}</div>{c && !c.ok && <div className="faint" style={{ fontSize: 12 }}>Keys go in Vercel → Settings → Environment Variables: {how}. Then redeploy.</div>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
