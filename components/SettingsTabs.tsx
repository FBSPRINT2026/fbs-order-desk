"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Everything under Settings: shop pricing and setup, garments, the Assistant & AI, and connections. */
export const SETTINGS_TABS: [string, string][] = [
  ["/shop/settings#pricing", "Pricing"],
  ["/shop/settings#payments", "Payments"],
  ["/shop/catalog", "Garments"],
  ["/shop/settings/production", "Production"],
  ["/shop/settings#assistant", "Assistant & AI"],
  ["/shop/settings#shop", "Shop info"],
  ["/shop/settings#staff", "Staff"],
  ["/shop/settings/access", "User Access"],
  ["/shop/settings#connections", "Connections"],
];

export default function SettingsTabs() {
  const path = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const isOn = (href: string) => {
    const [p, h] = href.split("#");
    if (p !== path) return false;
    return h ? hash === `#${h}` || (!hash && h === "pricing") : true;
  };
  return (
    <nav className="set-tabs" aria-label="Settings">
      {SETTINGS_TABS.map(([href, label]) => <Link key={href} href={href} className={isOn(href) ? "on" : ""} onClick={() => { const h = href.split("#")[1]; if (h) setHash(`#${h}`); }}>{label}</Link>)}
    </nav>
  );
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
      <div className="panel-h"><h2>Connections</h2><button type="button" className="btn sm" onClick={run} disabled={busy}>{busy ? "Checking…" : "Check again"}</button></div>
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
