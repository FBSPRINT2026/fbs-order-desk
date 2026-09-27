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
  customers: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.1 2.6 3.5 5.2" /></svg>,
  catalog: <svg viewBox="0 0 24 24"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg>,
  artwork: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 9" /></svg>,
  settings: <svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></svg>,
};

export default function ShopNav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [creating, setCreating] = useState(false);
  const [todo, setTodo] = useState({ all: 0, urgent: 0 });

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

  const items: [string, string, string][] = [
    ["/shop", "orders", "Orders"],
    ["/shop/assistant", "assistant", "Assistant"],
    ["/shop/incoming", "incoming", "Incoming orders"],
    ["/shop/board", "board", "Production"],
    ["/shop/calendar", "calendar", "Calendar"],
    ["/shop/customers", "customers", "Customers"],
    ["/shop/artwork", "artwork", "Artwork"],
    ["/shop/catalog", "catalog", "Garments"],
    ["/shop/settings", "settings", "Pricing & shop"],
  ];
  const active = (href: string) => (href === "/shop" ? path === "/shop" || path.startsWith("/shop/orders") : path.startsWith(href));

  async function newQuote() {
    setCreating(true);
    const sb = createClient();
    const { data, error } = await sb.from("orders").insert({ lines: [], status: "quote", type: "quote" }).select("id").single();
    setCreating(false);
    if (!error && data) router.push(`/shop/orders/${data.id}?new=1`);
    else alert("Couldn't create the quote: " + (error?.message || ""));
  }

  return (
    <aside className="side">
      <div className="brand"><b>FBS Order Desk</b><span>Shop management</span></div>
      <nav className="nav">
        {items.map(([href, icon, label]) => (
          <Link key={href} href={href} className={active(href) ? "on" : ""} title={label}>
            {ICONS[icon]}<span className="lbl-t">{label}</span>
            {href === "/shop/assistant" && todo.all > 0 && <span className={"badge" + (todo.urgent ? "" : " soft")} title={`${todo.all} follow-up${todo.all === 1 ? "" : "s"}${todo.urgent ? `, ${todo.urgent} urgent` : ""}`}>{todo.urgent || todo.all}</span>}
            {href === "/shop/incoming" && incoming > 0 && <span className="badge" title={`${incoming} order request${incoming === 1 ? "" : "s"} to review`}>{incoming}</span>}
            {href === "/shop" && unread > 0 && <span className="badge" title={`${unread} unread customer message${unread === 1 ? "" : "s"}`}>{unread}</span>}
          </Link>
        ))}
      </nav>
      <button className="btn primary btn-new" type="button" onClick={newQuote} disabled={creating}>{creating ? "Creating…" : "+ New quote"}</button>
      <div className="side-user">
        <span>{email}</span>
        <form action="/auth/signout" method="post"><button className="btn ghost sm" style={{ color: "inherit", padding: 0 }} type="submit">Sign out</button></form>
      </div>
    </aside>
  );
}
