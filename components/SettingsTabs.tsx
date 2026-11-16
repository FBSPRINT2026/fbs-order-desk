"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Settings (Nov 16, Nick, option B: "it's gotten too much info and it's hard to use… make the left menu headers stand
 * out more"). One list down the left, in six groups with a colored icon each, and the picked page on the right; a search
 * at the top of the list finds a setting by any word on it. Pages that belong together are one item with a switch
 * across their top (Retail | Wholesale, Staff | What they see…). It was seven tabs with a second row of buttons (Oct 24).
 * Every settings page draws `SettingsHead` (its name, the group above it, its buttons) and `SettingsTabs` (that switch);
 * `SettingsFrame` (app/shop/settings/layout.tsx, and the garment catalog's page) puts the list beside them.
 * Settings opens on the page you were last on.
 */
type Item = { label: string; note: string; paths: [string, string][]; words: string; ownNote?: boolean };
type Group = { k: string; label: string; icon: string; tone: string; items: Item[] };
export const SETTINGS_GROUPS: Group[] = [
  { k: "business", label: "Business", icon: "M3 10l9-6 9 6v10H3z", tone: "blue", items: [
    { label: "Shop info & logo", note: "Name, contact, terms and the menu logo: shown in the portal, emails and invoices", paths: [["/shop/settings/shop", ""]], words: "name phone email address facebook instagram terms logo menu tagline brand" },
    { label: "Portal launch email", note: "The email that invites customers to their portal", paths: [["/shop/settings/launch-email", ""]], words: "invite welcome portal customers" },
  ] },
  { k: "money", label: "Money", icon: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6", tone: "green", items: [
    { label: "Price lists", note: "What screen printing, embroidery, DTF and garments cost, by quantity", paths: [["/shop/settings/pricing/retail", "Retail"], ["/shop/settings/pricing/wholesale", "Wholesale"]], words: "prices tiers breaks markup screens screen fee pms ink change underbase dtf dtg embroidery digitizing stitches minimum wholesale retail" },
    { label: "Add-ons", note: "Finishing: fold, bag, tags, labels", paths: [["/shop/settings/pricing/addons", ""]], words: "finishing fold bag tag label add-on" },
    { label: "Tax & payments", note: "Sales tax, deposit, card fee, and how customers pay in their portal", paths: [["/shop/settings/pricing/payments", ""]], words: "sales tax deposit card fee surcharge zelle venmo pay" },
    { label: "QuickBooks", note: "The sync, and anything that didn't go through", paths: [["/shop/settings/quickbooks", ""]], words: "quickbooks qbo invoices sync accounting" },
  ] },
  { k: "production", label: "Production", icon: "M3 7h18v10H3zM7 7V4h10v3", tone: "orange", items: [
    { label: "Machines & crews", note: "The presses and heads, and who runs each", paths: [["/shop/settings/production", ""]], words: "press machines embroidery heads crews operator catcher assistant schedule" },
    { label: "Run times & real speed", note: "How long jobs take, planned and as really run", paths: [["/shop/settings/production/times", "Run times"], ["/shop/settings/production/speed", "Real speed"]], words: "run time speed setup minutes pieces per hour" },
    { label: "Garments", note: "", ownNote: true, paths: [["/shop/catalog", "Garment catalog"], ["/shop/settings/garments/popular", "Popular garments"]], words: "catalog styles colors brands popular garments blanks" },
  ] },
  { k: "people", label: "People & logins", icon: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M21 20c0-2-1-4-4-5", tone: "salmon", items: [
    { label: "Staff & what they see", note: "Who signs in to the shop side, their role, and what each person can see and do", paths: [["/shop/settings/people/staff", "Staff"], ["/shop/settings/access", "What they see"]], words: "staff logins roles access permissions money user access" },
    { label: "Account owners", note: "Who handles which customers", paths: [["/shop/settings/people/owners", ""]], words: "account owners customers rep" },
    { label: "Shop computers", note: "FBS-REC, FBS-PRESS, FBS-SHIP and FBS-PO: their PIN and the shop's network", paths: [["/shop/settings/people/stations", ""]], words: "shop computers station pin network wifi rec press ship po" },
  ] },
  { k: "ai", label: "Assistant & AI", icon: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", tone: "purple", items: [
    { label: "Follow-ups & AI", note: "When the Assistant flags follow-ups, and what AI may do", paths: [["/shop/settings/assistant", ""]], words: "assistant follow up reminders quote proof pickup ai claude model voice" },
    { label: "Order training", note: "Rules and worked examples the order reader learns from", paths: [["/shop/settings/assistant/training", ""]], words: "order training reader rules examples" },
  ] },
  { k: "connections", label: "Email, files & backups", icon: "M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8", tone: "gray", items: [
    { label: "Site email", note: "The addresses the site sends from and reads", paths: [["/shop/settings/site-email", ""]], words: "email mailbox address signature" },
    { label: "Texts (Mac)", note: "Customer texts through the Mac", paths: [["/shop/settings/texts", ""]], words: "texts sms messages mac" },
    { label: "Dropbox & backups", note: "Where art files live, the home backup drive, and restore points", paths: [["/shop/settings/dropbox", ""]], words: "dropbox files backup drive restore point" },
    { label: "Canva", note: "Canva designs", paths: [["/shop/settings/canva", ""]], words: "canva designs" },
    { label: "Service status", note: "Is each outside service working", paths: [["/shop/settings/status", ""]], words: "status stax claude sanmar working keys" },
  ] },
];
/** settings that live on their own pages, listed at the bottom so they can be found from here too */
const ELSEWHERE: [string, string, string][] = [
  ["/shop/receiving?view=settings", "Receiving settings", "manifest mailbox receiving"],
  ["/shop/time?tab=settings", "Time clock settings", "time clock punches lunch overtime"],
  ["/shop/time?tab=employees", "Phone logins", "phone view employees crew pin"],
];
const LAST = "fbs:settings.last";
const read = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const where = (path: string) => { for (const g of SETTINGS_GROUPS) for (const it of g.items) if (it.paths.some(([h]) => h === path)) return { g, it }; return null; };
export const groupOf = (path: string) => where(path)?.g || null;
/** where Settings opens: the page you were last on */
export const lastSettingsPage = () => read(LAST) || "/shop/settings/shop";
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden><path d={d} /></svg>;

/** the list down the left, with the page beside it */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const [last, setLast] = useState<Record<string, string>>({});
  useEffect(() => {
    const w = where(path);
    if (w) { write(LAST, path); write(`${LAST}.${w.it.paths[0][0]}`, path); }
    setLast(Object.fromEntries(SETTINGS_GROUPS.flatMap((g) => g.items).map((it) => [it.paths[0][0], read(`${LAST}.${it.paths[0][0]}`)])));
  }, [path]);
  const t = q.trim().toLowerCase();
  const hit = (s: string) => !t || t.split(/\s+/).every((w) => s.toLowerCase().includes(w));
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => hit(`${g.label} ${it.label} ${it.note} ${it.paths.map((p) => p[1]).join(" ")} ${it.words}`)) })).filter((g) => g.items.length);
  const away = ELSEWHERE.filter(([, l, w]) => hit(`${l} ${w}`));
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="eyebrow">Pick from the list. Settings opens on the page you were last on.</div></div></div>
      <div className="setx">
        <nav className="setx-nav" aria-label="Settings">
          <label className="setx-find"><svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg><input type="search" placeholder="Find a setting…" aria-label="Find a setting" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {groups.map((g) => (
            <div key={g.k} className="setx-grp">
              <div className={"setx-gh tone-" + g.tone}><span className="setx-gi"><Ico d={g.icon} /></span><span>{g.label}</span></div>
              {g.items.map((it) => {
                const on = it.paths.some(([h]) => h === path);
                const remembered = last[it.paths[0][0]];
                const href = remembered && it.paths.some(([h]) => h === remembered) ? remembered : it.paths[0][0];
                return <Link key={it.label} href={href} className={"setx-it" + (on ? " on" : "")} aria-current={on ? "page" : undefined}>{it.label}</Link>;
              })}
            </div>
          ))}
          {away.length > 0 && <div className="setx-grp setx-away"><div className="setx-gh tone-gray"><span className="setx-gi"><Ico d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" /></span><span>On their own pages</span></div>{away.map(([h, l]) => <Link key={h} href={h} className="setx-it">{l}</Link>)}</div>}
          {!groups.length && !away.length && <div className="faint setx-none">No setting matches “{q}”.</div>}
        </nav>
        <div className="setx-main">{children}</div>
      </div>
    </>
  );
}

/** the switch across the top of an item made of two pages (Retail | Wholesale…) */
export default function SettingsTabs() {
  const path = usePathname();
  const w = where(path);
  if (!w || w.it.paths.length < 2) return null;
  return (
    <div className="toolbar setx-sub" data-toolbar>
      <div className="chips">{w.it.paths.map(([h, l]) => <Link key={h} href={h} className={"chip" + (h === path ? " on" : "")}>{l}</Link>)}</div>
    </div>
  );
}

/** a settings page's header: its group, its name and one line under it, the page's buttons on the right */
export function SettingsHead({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  const path = usePathname();
  const w = where(path);
  const line = w && !w.it.ownNote && w.it.note ? w.it.note : note;
  return <div className="setx-head"><div><div className="setx-hg">{w?.g.label || "Settings"}</div><h2>{w?.it.label || title}</h2>{line && <div className="faint">{line}</div>}</div>{children ? <div className="row">{children}</div> : null}</div>;
}

type Check = { ok: boolean; detail: string };
/** Live status of the outside services (Stax, Claude, SanMar). Never shows keys. */
export function ConnectionsPanel() {
  const [res, setRes] = useState<Record<string, Check> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); fetch("/api/health/apis", { cache: "no-store" }).then((r) => r.json()).then(setRes).catch(() => setRes(null)).finally(() => setBusy(false)); };
  useEffect(run, []);
  const rows: [string, string, string][] = [
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
