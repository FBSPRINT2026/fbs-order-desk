"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ICONS: Record<string, React.ReactNode> = {
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
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const sb = createClient();
    sb.from("messages").select("id", { count: "exact", head: true }).eq("author_type", "customer").is("read_at", null)
      .then(({ count }) => setUnread(count || 0));
  }, [path]);

  const items: [string, string, string][] = [
    ["/shop", "orders", "Orders"],
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
