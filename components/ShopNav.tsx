"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { applyDecisions, computeFollowUps, loadAssistantData, loadDecisions } from "@/lib/crm/followups";

const ICONS: Record<string, React.ReactNode> = {
  assistant: <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg>,
  incoming: <svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></svg>,
  orders: <svg viewBox="0 0 24 24"><path d="M7 3h10l3 3v15H4V3z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>,
  board: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></svg>,
  calendar: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  projects: <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 7V5a1 1 0 0 1 1-1h5l2 2" /></svg>,
  customers: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.1 2.6 3.5 5.2" /></svg>,
  catalog: <svg viewBox="0 0 24 24"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg>,
  goods: <svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5z" /><path d="M3 9v6l9 5 9-5V9" /><path d="M12 14v6" /></svg>,
  shipping: <svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>,
  artwork: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 9" /></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function ShopNav({ email, firstName, brand }: { email: string; firstName: string; brand: { sideLogoUrl: string; sideLogoWidth: number; sideTagline: string } }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [creating, setCreating] = useState(false);
  const [todo, setTodo] = useState({ all: 0, urgent: 0 });
  const [hello, setHello] = useState("Hello");
  const [q, setQ] = useState("");
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
    { title: "Sales", items: [["/shop", "orders", "Orders"], ["/shop/incoming", "incoming", "Incoming orders"], ["/shop/projects", "projects", "Projects"], ["/shop/customers", "customers", "Customers"]] },
    { title: "Production", items: [["/shop/artwork", "artwork", "Artwork"], ["/shop/board", "board", "Production"], ["/shop/calendar", "calendar", "Production calendar"]] },
    { title: "Shop tools", items: [["/shop/shipping", "shipping", "Shipping center"], ["/shop/receiving", "goods", "Goods & receiving"]] },
  ];
  const active = (href: string) => (href === "/shop" ? path === "/shop" || path.startsWith("/shop/orders") : href === "/shop/settings" ? path.startsWith("/shop/settings") || path.startsWith("/shop/catalog") : path.startsWith(href));

  async function newQuote() {
    setCreating(true);
    const sb = createClient();
    const { data, error } = await sb.from("orders").insert({ lines: [], status: "quote", type: "quote" }).select("id").single();
    setCreating(false);
    if (!error && data) router.push(`/shop/orders/${data.id}?new=1`);
    else alert("Couldn't create the quote: " + (error?.message || ""));
  }

  const link = ([href, icon, label]: [string, string, string]) => (
    <Link key={href} href={href} className={active(href) ? "on" : ""} title={label}>
      {ICONS[icon]}<span className="lbl-t">{label}</span>
      {href === "/shop/assistant" && todo.all > 0 && <span className={"badge" + (todo.urgent ? "" : " soft")} title={`${todo.all} follow-up${todo.all === 1 ? "" : "s"}${todo.urgent ? `, ${todo.urgent} urgent` : ""}`}>{todo.urgent || todo.all}</span>}
      {href === "/shop/incoming" && incoming > 0 && <span className="badge" title={`${incoming} order request${incoming === 1 ? "" : "s"} to review`}>{incoming}</span>}
      {href === "/shop" && unread > 0 && <span className="badge" title={`${unread} unread customer message${unread === 1 ? "" : "s"}`}>{unread}</span>}
    </Link>
  );

  return (
    <aside className="side">
      <Link href="/shop" className="brand brand-logo" title="Home">
        {brand.sideLogoUrl ? <img src={brand.sideLogoUrl} alt="FBS" style={{ width: brand.sideLogoWidth || 64 }} /> : <b>FBS</b>}
        {brand.sideTagline && <span>{brand.sideTagline}</span>}
      </Link>
      <div className="side-hello">{hello}{firstName ? `, ${firstName}` : ""}</div>
      <form className="side-search" role="search" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/shop/search?q=${encodeURIComponent(t)}`); }}>
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…" aria-label="Search orders, customers, artwork, shipments" />
      </form>
      <nav className="nav">
        {link(["/shop/assistant", "assistant", "Assistant"])}
        {GROUPS.map((g) => (
          <div key={g.title} className="nav-g">
            <div className="nav-h">{g.title}</div>
            {g.items.map(link)}
          </div>
        ))}
      </nav>
      <button className="btn primary btn-new btn-side" type="button" onClick={newQuote} disabled={creating}>{creating ? "Creating…" : "+ New quote"}</button>
      <nav className="nav nav-foot">{link(["/shop/settings", "settings", "Settings"])}</nav>
      <div className="side-user">
        <span>{email}</span>
        <form action="/auth/signout" method="post"><button className="btn ghost sm" style={{ color: "inherit", padding: 0 }} type="submit">Sign out</button></form>
      </div>
    </aside>
  );
}
