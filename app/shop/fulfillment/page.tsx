"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { mergeSettings } from "@/lib/pricing";
import { useSticky } from "@/lib/useSticky";

/**
 * Fulfillment (Nov 11 2026, Nick): the hand work after the press (folding, bagging, barcodes, tags, packing). This first
 * version is the list: every job with finishing on it, what has to happen and where the job is. One of the shop floor's
 * three areas with Receiving and Outbound, the same whatever SP / EMB / HP is picked.
 */
type Row = { key: string; href: string; number: string; job: string; customer: string; qty: number; due: string | null; steps: string[]; where: "wait" | "press" | "finish"; printavo: boolean };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const WHERE = { wait: "Waiting on the press", press: "On the press", finish: "Ready to finish" } as const;

export default function Fulfillment() {
  const [tab, setTab] = useSticky<"all" | "finish" | "press" | "wait">("fulfill.tab", "all");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [n, p, st] = await Promise.all([
        sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, status, groups").is("discarded_at", null).in("status", ["approved", "production", "ready"]).order("due_date", { ascending: true, nullsFirst: false }).limit(800),
        sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, status_name").is("removed_at", null).ilike("status_name", "%fulfillment%").order("due_date", { ascending: true, nullsFirst: false }).limit(300),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      ]);
      const s = mergeSettings(st.data?.data);
      const fin = new Map((s.finishing || []).map((f) => [f.id, f.name]));
      type N = { id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; status: string; groups: { finishing?: string[] }[] | null };
      type P = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string | null; status_name: string };
      // finishing is fold, poly bag, barcode, tags… (embroidery extras like puff are the press's, not fulfillment's)
      const ns = ((n.data || []) as N[]).map((o) => ({ o, steps: [...new Set((o.groups || []).flatMap((g) => g.finishing || []).filter((id) => !/^(emb_|vinyl_)/.test(id)).map((id) => fin.get(id) || id.replace(/^fin_/, "").replace(/_/g, " ")))] })).filter((x) => x.steps.length);
      const ps = (p.data || []) as P[];
      const ids = [...new Set([...ns.map((x) => x.o.customer_id), ...ps.map((o) => o.customer_id)].filter(Boolean))] as string[];
      const { data: cs } = ids.length ? await sb.from("customers").select("id, company, name").in("id", ids) : { data: [] };
      const cust = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, custLabel(c)]));
      setRows([
        ...ns.map(({ o, steps }): Row => ({ key: "o" + o.id, href: `/shop/orders/${o.id}`, number: String(o.number), job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, steps, where: o.status === "ready" ? "finish" : o.status === "production" ? "press" : "wait", printavo: false })),
        ...ps.map((o): Row => ({ key: "a" + o.id, href: `/shop/archive/${o.id}`, number: o.visual_id, job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, steps: ["Finishing (Printavo)"], where: "finish", printavo: true })),
      ].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")));
    })();
  }, []);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const of = (w: Row["where"]) => (rows || []).filter((r) => r.where === w);
  const shown = tab === "all" ? rows || [] : of(tab);
  const pcs = (rs: Row[]) => rs.reduce((t, r) => t + r.qty, 0);
  return (
    <>
      <div className="page-head"><div><h1>Fulfillment</h1><div className="eyebrow">Hand finishing after the press: folding, bagging, barcodes, tags and packing</div></div></div>
      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("finish")}><span className="v">{rows ? of("finish").length : "…"}</span><span className="k">Ready to finish</span></button>
        <button type="button" className="stat" onClick={() => setTab("press")}><span className="v">{rows ? of("press").length : "…"}</span><span className="k">On the press</span></button>
        <button type="button" className="stat" onClick={() => setTab("wait")}><span className="v">{rows ? of("wait").length : "…"}</span><span className="k">Waiting on the press</span></button>
        <button type="button" className="stat"><span className="v">{rows ? pcs(rows).toLocaleString() : "…"}</span><span className="k">Pieces to finish</span></button>
        <button type="button" className="stat"><span className={"v" + ((rows || []).some((r) => r.due && r.due.slice(0, 10) < today) ? " alert" : "")}>{(rows || []).filter((r) => r.due && r.due.slice(0, 10) < today).length}</span><span className="k">Past in-hands</span></button>
      </div>
      <div className="toolbar ob-tabs"><div className="chips">
        {([["all", "All"], ["finish", "Ready to finish"], ["press", "On the press"], ["wait", "Waiting on the press"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}<span className="chip-n">{rows ? (k === "all" ? rows.length : of(k).length) : ""}</span></button>)}
      </div></div>
      {!rows ? <div className="faint">Loading…</div> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Job</th><th>Customer</th><th>What has to happen</th><th>Pieces</th><th>Where it is</th><th>In-hands</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.key}><td><Link className="ordno" href={r.href}>#{r.number}</Link><div className="sub">{r.job}</div></td><td>{r.customer}</td>
              <td><span className="ff-steps">{r.steps.map((x) => <span key={x}>{x}</span>)}</span></td><td>{r.qty.toLocaleString()}</td>
              <td>{WHERE[r.where as Row["where"]]}</td><td className={r.due && r.due.slice(0, 10) < today ? "ob-late" : ""}>{day(r.due)}</td></tr>
          ))}
          {!shown.length && <tr><td colSpan={6} className="faint">No jobs with finishing here. Finishing (fold, poly bag, barcode, tags) is ticked on each group of an order.</td></tr>}</tbody>
        </table></div>
      )}
    </>
  );
}
