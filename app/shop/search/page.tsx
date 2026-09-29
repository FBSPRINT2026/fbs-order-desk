"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchInput from "@/components/SearchInput";

type Hit = { href: string; title: string; sub: string; tag?: string };
type Results = { orders: Hit[]; printavo: Hit[]; customers: Hit[]; projects: Hit[]; artwork: Hit[]; shipments: Hit[] };
const EMPTY: Results = { orders: [], printavo: [], customers: [], projects: [], artwork: [], shipments: [] };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "");

/** Search everything from the left menu: orders, Printavo orders, customers, projects, artwork, supplier shipments. */
function SearchInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const q0 = sp.get("q") || "";
  const [q, setQ] = useState(q0);
  const [res, setRes] = useState<Results | null>(null);
  const [ai, setAi] = useState<{ answer?: string; refs?: { label: string; href: string }[]; off?: boolean; reason?: string; error?: string; busy?: boolean } | null>(null);
  // the AI answer: asked once the keyword results are in (it reads them too)
  useEffect(() => {
    const t = q0.trim();
    if (!res || t.length < 3) { setAi(null); return; }
    const found = (["orders", "printavo", "customers", "shipments"] as (keyof Results)[]).flatMap((k) => res[k].slice(0, 15).map((h) => ({ ref: h.href.replace("/shop/orders/", "o:").replace("/shop/archive/", "a:").replace("/shop/customers/", "c:"), text: `${h.title} · ${h.sub}` })));
    let live = true;
    setAi({ busy: true });
    fetch("/api/ai/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: t, found }) })
      .then((r) => r.json()).then((j) => { if (live) setAi(j.skip ? null : j); }).catch(() => { if (live) setAi({ error: "The AI couldn't answer right now." }); });
    return () => { live = false; };
  }, [res, q0]);
  useEffect(() => { setQ(q0); }, [q0]);
  useEffect(() => {
    const t = q0.trim().replace(/[%,()*]/g, " ").trim();
    if (t.length < 2) { setRes(EMPTY); return; }
    setRes(null);
    const sb = createClient();
    const like = `%${t}%`;
    const num = /^#?\d{3,7}$/.test(t) ? t.replace("#", "") : "";
    (async () => {
      const [o, a, c, p, d, m] = await Promise.all([
        sb.from("orders").select("id, number, nickname, po_number, status, due_date, customers(company, name)").or([`nickname.ilike.${like}`, `po_number.ilike.${like}`, ...(num ? [`number.eq.${num}`] : [])].join(",")).order("number", { ascending: false }).limit(25),
        sb.from("archived_orders").select("id, visual_id, nickname, po_number, status_name, due_date, customers(company, name)").or([`search_staff.ilike.${like}`, `nickname.ilike.${like}`, `po_number.ilike.${like}`, ...(num ? [`visual_id.eq.${num}`] : [])].join(",")).order("visual_id", { ascending: false }).limit(25),
        sb.from("customers").select("id, company, name, email").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).order("company").limit(25),
        sb.from("projects").select("id, name, status, customers(company, name)").ilike("name", like).limit(15),
        sb.from("designs").select("id, number, name, customers(company, name)").or([`name.ilike.${like}`, ...(num ? [`number.eq.${num}`] : [])].join(",")).order("number", { ascending: false }).limit(15),
        fetch(`/api/goods/manifest?q=${encodeURIComponent(t)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      type C = { customers: { company: string; name: string } | null };
      const who = (x: C) => x.customers?.company || x.customers?.name || "";
      setRes({
        orders: ((o.data || []) as unknown as ({ id: string; number: number; nickname: string; po_number: string; status: string; due_date: string | null } & C)[]).map((x) => ({ href: `/shop/orders/${x.id}`, title: `#${x.number} ${x.nickname || ""}`.trim(), sub: [who(x), x.po_number ? `PO ${x.po_number}` : "", x.due_date ? `due ${day(x.due_date)}` : ""].filter(Boolean).join(" · "), tag: x.status })),
        printavo: ((a.data || []) as unknown as ({ id: string; visual_id: string; nickname: string; po_number: string; status_name: string; due_date: string | null } & C)[]).map((x) => ({ href: `/shop/archive/${x.id}`, title: `#${x.visual_id} ${x.nickname || ""}`.trim(), sub: [who(x), x.po_number && x.po_number !== x.nickname ? `PO ${x.po_number}` : "", x.due_date ? `due ${day(x.due_date)}` : ""].filter(Boolean).join(" · "), tag: x.status_name })),
        customers: ((c.data || []) as { id: string; company: string; name: string; email: string }[]).map((x) => ({ href: `/shop/customers/${x.id}`, title: x.company || x.name, sub: [x.company ? x.name : "", x.email].filter(Boolean).join(" · ") })),
        projects: ((p.data || []) as unknown as ({ id: string; name: string; status: string } & C)[]).map((x) => ({ href: `/shop/projects/${x.id}`, title: x.name, sub: who(x), tag: x.status })),
        artwork: ((d.data || []) as unknown as ({ id: string; number: number; name: string } & C)[]).map((x) => ({ href: `/shop/artwork/${x.id}`, title: `${x.number ? `#${x.number} ` : ""}${x.name || "Design"}`, sub: who(x) })),
        shipments: ((m.hits || []) as { who: string; supplier: string; supplier_order: string; po: string; ship_date: string | null; boxes: number; pcs: number; order: { number: number; href: string } | null }[]).map((x) => ({ href: x.order?.href || `/shop/receiving`, title: `${x.who} · ${x.supplier === "sanmar" ? "SanMar" : "S&S"} ${x.supplier_order}`, sub: [x.po ? `PO ${x.po}` : "", `${x.boxes} box${x.boxes === 1 ? "" : "es"}, ${x.pcs} pcs`, x.ship_date ? `shipped ${day(x.ship_date)}` : "", x.order ? `on #${x.order.number}` : "not linked yet"].filter(Boolean).join(" · ") })),
      });
    })();
  }, [q0]);
  const SECTIONS: [keyof Results, string][] = [["orders", "Orders"], ["printavo", "Printavo orders"], ["customers", "Customers"], ["projects", "Projects"], ["artwork", "Artwork"], ["shipments", "Supplier shipments"]];
  const total = res ? SECTIONS.reduce((n, [k]) => n + res[k].length, 0) : 0;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Search</div><h1>{q0 ? `“${q0}”` : "Search Everything"}</h1></div></div>
      <form className="srch-box" onSubmit={(e) => { e.preventDefault(); router.replace(`/shop/search?q=${encodeURIComponent(q.trim())}`); }}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onDictated={(t) => { if (t.trim()) router.replace(`/shop/search?q=${encodeURIComponent(t.trim())}`); }} placeholder="Ask anything, or search an order #, customer, PO, tracking…" autoFocus aria-label="Search" />
        <button type="submit" className="btn primary">Search</button>
      </form>
      {ai && !ai.off && (
        <section className="ai-ans">
          <div className="ai-ans-h"><svg viewBox="0 0 24 24" aria-hidden><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg><b>AI answer</b></div>
          {ai.busy ? <div className="ai-ans-b faint">Thinking…</div> : ai.error ? <div className="ai-ans-b bad">{ai.error}</div> : (
            <>
              <div className="ai-ans-b">{ai.answer}</div>
              {!!ai.refs?.length && <div className="ai-refs">{ai.refs.map((r, i) => <Link key={i} href={r.href} className="ai-ref">{r.label}</Link>)}</div>}
            </>
          )}
        </section>
      )}
      {ai?.off && <div className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>AI answers are off: {ai.reason}</div>}
      {!res ? <div className="empty">Searching…</div> : q0.trim().length < 2 ? <div className="empty">Type at least 2 characters.</div> : !total ? <div className="empty">Nothing found for “{q0}”.</div> : (
        <div className="srch-grid">
          {SECTIONS.filter(([k]) => res[k].length).map(([k, label]) => (
            <section key={k} className="panel">
              <div className="panel-h"><h2>{label}</h2><span className="faint">{res[k].length}{res[k].length >= 25 ? "+" : ""}</span></div>
              <ul className="srch-list">{res[k].map((h, i) => (
                <li key={i}><Link href={h.href}><b>{h.title}</b>{h.tag && <span className="rv-tag">{h.tag}</span>}<br /><span className="faint">{h.sub}</span></Link></li>
              ))}</ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><SearchInner /></Suspense>;
}
