"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import ShippingCenter from "../shipping/page";

/**
 * Outbound (Nov 11 2026, Nick): everything done printing that has to leave the shop, by how it leaves: shipped (the
 * Shipping Center), delivered (our driver or a courier) or picked up off the shelf. One of the shop floor's three areas
 * with Receiving and Fulfillment, the same whatever SP / EMB / HP is picked.
 */
type Row = { key: string; href: string; number: string; job: string; customer: string; qty: number; due: string | null; since: string | null; printavo: boolean; how: "ship" | "deliver" | "pickup" };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null);
const howOf = (s: string) => (/pick/i.test(s) ? "pickup" : /deliver|courier|drop/i.test(s) ? "deliver" : "ship") as Row["how"];

export default function Outbound() {
  const [tab, setTab] = useSticky<"ship" | "deliver" | "pickup">("outbound.tab", "ship");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [n, p] = await Promise.all([
        sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, delivery_method, updated_at").is("discarded_at", null).eq("status", "ready").order("due_date", { ascending: true, nullsFirst: false }).limit(500),
        sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, status_name, updated_at, delivery:data->deliveryMethod").is("removed_at", null).ilike("status_name", "%ready to ship%").order("due_date", { ascending: true, nullsFirst: false }).limit(500),
      ]);
      type N = { id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; delivery_method: string | null; updated_at: string };
      type P = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string | null; updated_at: string; delivery: string | null };
      const ns = (n.data || []) as N[], ps = (p.data || []) as unknown as P[];
      const ids = [...new Set([...ns, ...ps].map((o) => o.customer_id).filter(Boolean))] as string[];
      const { data: cs } = ids.length ? await sb.from("customers").select("id, company, name").in("id", ids) : { data: [] };
      const cust = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, custLabel(c)]));
      setRows([
        ...ns.map((o): Row => ({ key: "o" + o.id, href: `/shop/orders/${o.id}`, number: String(o.number), job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, since: o.updated_at, printavo: false, how: howOf(o.delivery_method || "ship") })),
        ...ps.map((o): Row => ({ key: "a" + o.id, href: `/shop/archive/${o.id}`, number: o.visual_id, job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, since: o.updated_at, printavo: true, how: howOf(String(o.delivery || "ship")) })),
      ]);
    })();
  }, []);
  const of = (h: Row["how"]) => (rows || []).filter((r) => r.how === h);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const late = (rows || []).filter((r) => r.due && r.due.slice(0, 10) < today);
  const shelfOld = of("pickup").filter((r) => (daysSince(r.since) ?? 0) >= 5);
  const list = (rs: Row[], kind: "deliver" | "pickup") => (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Job</th><th>Customer</th><th>Pieces</th><th>In-hands</th><th>{kind === "pickup" ? "On the shelf" : "Ready since"}</th></tr></thead>
      <tbody>{rs.map((r) => { const d = daysSince(r.since); return (
        <tr key={r.key}><td><Link className="ordno" href={r.href}>#{r.number}</Link><div className="sub">{r.job}</div></td><td>{r.customer}</td><td>{r.qty.toLocaleString()}</td>
          <td className={r.due && r.due.slice(0, 10) < today ? "ob-late" : ""}>{day(r.due)}</td>
          <td className={kind === "pickup" && (d ?? 0) >= 5 ? "ob-late" : ""}>{d == null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`}</td></tr>
      ); })}
      {!rs.length && <tr><td colSpan={5} className="faint">{kind === "pickup" ? "Nothing on the pickup shelf." : "Nothing to deliver."}</td></tr>}</tbody>
    </table></div>
  );
  return (
    <>
      <div className="page-head"><div><h1>Outbound</h1><div className="eyebrow">Done printing and ready to leave: what ships, what we deliver, what&apos;s on the shelf for pickup</div></div></div>
      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("ship")}><span className="v">{rows ? of("ship").length : "…"}</span><span className="k">To ship</span></button>
        <button type="button" className="stat" onClick={() => setTab("deliver")}><span className="v">{rows ? of("deliver").length : "…"}</span><span className="k">To deliver</span></button>
        <button type="button" className="stat" onClick={() => setTab("pickup")}><span className="v">{rows ? of("pickup").length : "…"}</span><span className="k">On the pickup shelf</span></button>
        <button type="button" className="stat" onClick={() => setTab("pickup")}><span className={"v" + (shelfOld.length ? " alert" : "")}>{shelfOld.length}</span><span className="k">Waiting 5+ days</span></button>
        <button type="button" className="stat"><span className={"v" + (late.length ? " alert" : "")}>{late.length}</span><span className="k">Past in-hands</span></button>
      </div>
      <div className="toolbar ob-tabs"><div className="chips">
        {([["ship", "Ship"], ["deliver", "Deliver"], ["pickup", "Pickup shelf"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}<span className="chip-n">{rows ? of(k).length : ""}</span></button>)}
      </div></div>
      {tab === "ship" ? <div className="ob-ship"><ShippingCenter /></div> : !rows ? <div className="faint">Loading…</div> : list(of(tab), tab)}
    </>
  );
}
