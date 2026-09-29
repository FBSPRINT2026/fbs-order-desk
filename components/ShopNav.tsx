"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { saveShortcuts, type Shortcut } from "@/app/shop/shortcut-actions";
import { applyDecisions, computeFollowUps, loadAssistantData, loadDecisions } from "@/lib/crm/followups";
import SearchInput from "@/components/SearchInput";

const ICONS: Record<string, React.ReactNode> = {
  home: <svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>,
  assistant: <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg>,
  incoming: <svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></svg>,
  orders: <svg viewBox="0 0 24 24"><path d="M7 3h10l3 3v15H4V3z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>,
  // a screen printing press seen from above: the center hub and its platens
  board: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.2" /><path d="M12 9.8V7M12 14.2V17M9.8 12H7M14.2 12H17" /><rect x="9.5" y="2.5" width="5" height="4.5" rx="1" /><rect x="9.5" y="17" width="5" height="4.5" rx="1" /><rect x="2.5" y="9.5" width="4.5" height="5" rx="1" /><rect x="17" y="9.5" width="4.5" height="5" rx="1" /></svg>,
  calendar: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  projects: <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 7V5a1 1 0 0 1 1-1h5l2 2" /></svg>,
  customers: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.1 2.6 3.5 5.2" /></svg>,
  catalog: <svg viewBox="0 0 24 24"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg>,
  team: <svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" /><circle cx="16.5" cy="9" r="2.5" /><path d="M2.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M14 14.3c.8-.4 1.6-.6 2.5-.6 2.2 0 3.9 1.5 4.5 4.3" /></svg>,
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  // a t-shirt (the blanks we receive)
  goods: <svg viewBox="0 0 24 24"><path d="M9 3.5L4 5.8 2.5 10.2l3.2 1.3.9-2.2V20.5h10.8V9.3l.9 2.2 3.2-1.3L20 5.8 15 3.5c-.4 1.6-1.6 2.6-3 2.6s-2.6-1-3-2.6z" /></svg>,
  shipping: <svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>,
  artwork: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 9" /></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function ShopNav({ email, firstName, brand, shortcuts }: { email: string; firstName: string; brand: { sideLogoUrl: string; sideLogoWidth: number; sideTagline: string }; shortcuts: Shortcut[] }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [todo, setTodo] = useState({ all: 0, urgent: 0 });
  const [hello, setHello] = useState("Hello");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false); // phones: the menu slides open from the top bar
  useEffect(() => { setOpen(false); }, [path]);
  const [mine, setMine] = useState<Shortcut[]>(shortcuts || []);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<Shortcut | null>(null);
  // desktop: the whole menu always fits the window height (it scales down on shorter screens instead of scrolling)
  const sideRef = useRef<HTMLElement>(null), inRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ z: number; h: number }>({ z: 1, h: 0 });
  useLayoutEffect(() => {
    const run = () => {
      const side = sideRef.current, el = inRef.current;
      if (!side || !el) return;
      if (window.innerWidth <= 820) { setFit({ z: 1, h: 0 }); return; }
      const cs = getComputedStyle(side);
      const avail = side.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const prevZ = el.style.zoom, prevH = el.style.minHeight;
      el.style.zoom = "1"; el.style.minHeight = "0";
      const need = el.scrollHeight;
      el.style.zoom = prevZ; el.style.minHeight = prevH;
      const z = need > avail ? Math.max(0.6, avail / need) : 1;
      setFit((f) => (Math.abs(f.z - z) < 0.005 && Math.abs(f.h - avail) < 1 ? f : { z, h: avail }));
    };
    run();
    window.addEventListener("resize", run);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    if (ro && inRef.current) Array.from(inRef.current.children).forEach((c) => ro.observe(c));
    return () => { window.removeEventListener("resize", run); ro?.disconnect(); };
  }, [mine.length, editing, adding]);
  async function store(next: Shortcut[]) { setMine(next); await saveShortcuts(next); }
  // "Pin this page": the page you're on, named by its heading
  function pinHere() {
    const h1 = (document.querySelector("main h1")?.textContent || document.title || "Page").trim().slice(0, 40);
    setAdding({ label: h1, href: window.location.pathname + window.location.search });
  }
  useEffect(() => { setHello(greet()); const t = setInterval(() => setHello(greet()), 10 * 60 * 1000); return () => clearInterval(t); }, []);

  // Assistant badge: follow-ups due now (refreshed every few minutes, not on every click)
  useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        const sb = createClient();
        const [data, st, dec, sg] = await Promise.all([
          loadAssistantData(sb),
          sb.from("settings").select("data").eq("id", 1).maybeSingle(),
          loadDecisions(sb),
          sb.from("ai_suggestions").select("status,snoozed_until,priority").neq("source", "rules").in("status", ["open", "snoozed"]).limit(1000),
        ]);
        const rows = (sg.data || []) as { status: string; snoozed_until: string | null; priority: number }[];
        const { open } = applyDecisions(computeFollowUps(data, mergeSettings(st.data?.data)), dec);
        const now = Date.now();
        const extra = rows.filter((r) => r.status === "open" || (r.snoozed_until && new Date(r.snoozed_until).getTime() <= now));
        if (live) setTodo({ all: open.length + extra.length, urgent: open.filter((x) => x.priority === 1).length + extra.filter((x) => x.priority === 1).length });
      } catch { /* the badge is a nice-to-have */ }
    };
    run();
    const t = setInterval(run, 5 * 60 * 1000);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const sb = createClient();
    sb.from("messages").select("id", { count: "exact", head: true }).eq("author_type", "customer").is("read_at", null)
      .then(({ count }) => setUnread(count || 0));
    sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "request").not("submitted_at", "is", null)
      .then(({ count }) => setIncoming(count || 0));
  }, [path]);

  // the menu, in groups
  const GROUPS: { title: string; items: [string, string, string][] }[] = [
    { title: "Sales", items: [["/shop/orders", "orders", "Orders"], ["/shop/incoming", "incoming", "Incoming Orders"], ["/shop/projects", "projects", "Projects"], ["/shop/customers", "customers", "Customers"]] },
    { title: "Production", items: [["/shop/artwork", "artwork", "Artwork"], ["/shop/board", "board", "Production"], ["/shop/employees", "team", "Employees"]] },
    { title: "Shop Tools", items: [["/shop/shipping", "shipping", "Shipping Center"], ["/shop/receiving", "goods", "Goods & Receiving"], ["/shop/time", "clock", "Time Clock"]] },
  ];
  const active = (href: string) => (href === "/shop" ? path === "/shop" : href === "/shop/board" ? path.startsWith("/shop/board") || path.startsWith("/shop/calendar") : href === "/shop/settings" ? path.startsWith("/shop/settings") || path.startsWith("/shop/catalog") : path.startsWith(href));


  const link = ([href, icon, label]: [string, string, string]) => (
    <Link key={href} href={href} className={active(href) ? "on" : ""} title={label}>
      {ICONS[icon]}<span className="lbl-t">{label}</span>
      {href === "/shop/assistant" && todo.all > 0 && <span className={"badge" + (todo.urgent ? "" : " soft")} title={`${todo.all} follow-up${todo.all === 1 ? "" : "s"}${todo.urgent ? `, ${todo.urgent} urgent` : ""}`}>{todo.urgent || todo.all}</span>}
      {href === "/shop/incoming" && incoming > 0 && <span className="badge" title={`${incoming} order request${incoming === 1 ? "" : "s"} to review`}>{incoming}</span>}
      {href === "/shop" && unread > 0 && <span className="badge" title={`${unread} unread customer message${unread === 1 ? "" : "s"}`}>{unread}</span>}
    </Link>
  );

  return (
    <aside className="side" ref={sideRef}>
      <div className="side-in" ref={inRef} style={fit.h ? { zoom: fit.z, minHeight: fit.h / fit.z } : undefined}>
      <Link href="/shop" className="brand brand-logo" title="Home">
        {brand.sideLogoUrl ? <img src={brand.sideLogoUrl} alt="FBS" style={{ width: brand.sideLogoWidth || 64 }} /> : <b>FBS</b>}
        {brand.sideTagline && <span>{brand.sideTagline}</span>}
      </Link>
      <button type="button" className="side-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {open ? <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg> : <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>}
      </button>
      <div className={"side-drawer" + (open ? " open" : "")}>
      <div className="side-hello">{hello}{firstName ? `, ${firstName}` : ""}</div>
      <form className="side-search" role="search" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/shop/search?q=${encodeURIComponent(t)}`); }}>
        <svg className="side-ai" viewBox="0 0 24 24" aria-hidden><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" /></svg>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask AI or search…" aria-label="Ask AI or search orders, customers, artwork, shipments"
          onDictated={(t) => { const x = t.trim(); if (x) router.push(`/shop/search?q=${encodeURIComponent(x)}`); }} />
      </form>
      <nav className="nav">
        {link(["/shop", "home", "Dashboard"])}
        {GROUPS.map((g) => (
          <div key={g.title} className={"nav-g nav-g-" + g.title.toLowerCase().replace(/\s+/g, "")}>
            <div className={"nav-h nav-h-" + g.title.toLowerCase().replace(/\s+/g, "")}>{g.title}</div>
            {g.items.map(link)}
          </div>
        ))}
      </nav>
      {/* my shortcuts: each admin's own quick links (customers, reports, dashboards, outside sites) */}
      <div className="nav-g nav-mine">
        <div className="nav-h">My Shortcuts</div>
        <nav className="nav">
          {mine.map((m, i) => (
            <div key={i} className="nav-mine-i">
              {/^https?:/i.test(m.href)
                ? <a href={m.href} target="_blank" rel="noreferrer" title={m.href}><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg><span className="lbl-t">{m.label}</span></a>
                : <Link href={m.href} className={path === m.href.split("?")[0] ? "on" : ""} title={m.href}><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" /></svg><span className="lbl-t">{m.label}</span></Link>}
              {editing && <span className="nav-mine-x">
                <button type="button" title="Move up" disabled={!i} onClick={() => { const n = [...mine]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; store(n); }}>↑</button>
                <button type="button" title="Rename" onClick={() => { const l = prompt("Name for this shortcut", m.label); if (l && l.trim()) store(mine.map((x, j) => (j === i ? { ...x, label: l.trim() } : x))); }}>✎</button>
                <button type="button" title="Remove" onClick={() => store(mine.filter((_, j) => j !== i))}>✕</button>
              </span>}
            </div>
          ))}
          {!mine.length && !adding && <div className="nav-mine-empty">Your own quick links: customers, reports, anything you open all the time.</div>}
        </nav>
        {adding ? (
          <form className="nav-add" onSubmit={(e) => { e.preventDefault(); if (adding.label.trim() && adding.href.trim()) { store([...mine, { label: adding.label.trim(), href: adding.href.trim() }]); setAdding(null); } }}>
            <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="Name" aria-label="Shortcut name" autoFocus />
            <input value={adding.href} onChange={(e) => setAdding({ ...adding, href: e.target.value })} placeholder="/shop/customers/… or https://…" aria-label="Shortcut link" />
            <div className="row" style={{ gap: 6 }}><button type="submit" className="btn primary sm">Add</button><button type="button" className="btn ghost sm" style={{ color: "inherit" }} onClick={() => setAdding(null)}>Cancel</button></div>
          </form>
        ) : (
          <div className="nav-add-btns"><button type="button" onClick={pinHere}>+ Pin this page</button><button type="button" onClick={() => setAdding({ label: "", href: "" })}>+ Add a link</button>{mine.length > 0 && <button type="button" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : "Edit"}</button>}</div>
        )}
      </div>
      <nav className="nav nav-foot">{link(["/shop/settings", "settings", "Settings"])}</nav>
      <div className="side-user">
        <span>{email}</span>
        <form action="/auth/signout" method="post"><button className="btn ghost sm" style={{ color: "inherit", padding: 0 }} type="submit">Sign out</button></form>
      </div>
      </div>
      </div>
    </aside>
  );
}
