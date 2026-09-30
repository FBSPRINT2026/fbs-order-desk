"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { fmtDate } from "@/lib/format";
import { SEP_STATUS, type SepRow } from "@/components/SeparationStudio";

/**
 * Separations queue (Production → Separations): every imprint waiting for films, from "Request Separations" on an
 * order. Open one to separate it here, or upload what came back from Separo.
 */
const TABS = [["open", "To do"], ["review", "Ready for review"], ["approved", "Approved"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];

export default function SeparationsPage() {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SepRow[] | null>(null);
  const [orders, setOrders] = useState<Record<string, { number: number; nickname: string; due_date: string | null }>>({});
  const [cust, setCust] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tab, setTab] = useSticky<Tab>("sep.tab.list", "open");
  const [q, setQ] = useState("");

  useEffect(() => { (async () => {
    const { data } = await sb.from("separations").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(500);
    const list = (data || []) as SepRow[];
    setRows(list);
    const oids = [...new Set(list.map((r) => r.order_id).filter(Boolean))] as string[], cids = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    const [{ data: o }, { data: c }] = await Promise.all([
      oids.length ? sb.from("orders").select("id, number, nickname, due_date").in("id", oids) : Promise.resolve({ data: [] }),
      cids.length ? sb.from("customers").select("id, company, name").in("id", cids) : Promise.resolve({ data: [] }),
    ]);
    setOrders(Object.fromEntries(((o || []) as { id: string; number: number; nickname: string; due_date: string | null }[]).map((x) => [x.id, x])));
    setCust(Object.fromEntries(((c || []) as { id: string; company: string; name: string }[]).map((x) => [x.id, x.company || x.name])));
    // a small picture: the saved proof, else the design
    const dids = [...new Set(list.filter((r) => !r.preview_path && r.design_id).map((r) => r.design_id))] as string[];
    const { data: ds } = dids.length ? await sb.from("designs").select("id, preview_path, file_path").in("id", dids) : { data: [] };
    const pathOf = new Map<string, string>();
    for (const r of list) { const d = ((ds || []) as { id: string; preview_path: string; file_path: string }[]).find((x) => x.id === r.design_id); const p = r.preview_path || d?.preview_path || d?.file_path; if (p) pathOf.set(r.id, p); }
    const paths = [...new Set(pathOf.values())];
    if (paths.length) { const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); const m = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""])); setThumbs(Object.fromEntries([...pathOf].map(([id, p]) => [id, m.get(p) || ""]))); }
  })(); }, [sb]);

  const shown = (rows || []).filter((r) => (tab === "all" ? true : tab === "open" ? r.status === "requested" || r.status === "in_progress" : tab === "review" ? r.status === "review" : r.status === "approved" || r.status === "films"))
    .filter((r) => { const s = q.trim().toLowerCase(); if (!s) return true; const o = r.order_id ? orders[r.order_id] : null; return [`s-${r.number}`, o ? `#${o.number} ${o.nickname}` : "", cust[r.customer_id || ""] || "", r.location, r.garment_color].join(" ").toLowerCase().includes(s); });
  const count = (t: Tab) => (rows || []).filter((r) => (t === "all" ? true : t === "open" ? r.status === "requested" || r.status === "in_progress" : t === "review" ? r.status === "review" : r.status === "approved" || r.status === "films")).length;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Production</div><h1>Separations</h1></div>
      </div>
      <div className="tmx-vbar">
        <div className="rv-seg">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{rows ? <span className="sep-cnt">{count(k)}</span> : null}</button>)}</div>
        <input className="tmx-q" type="search" placeholder="Order, customer, location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search separations" />
      </div>
      {!rows ? <div className="empty">Loading…</div> : !shown.length ? <div className="empty">{tab === "open" ? "Nothing waiting. Request separations from an approved order (Separations panel on the order)." : "Nothing here."}</div> : (
        <div className="sep-q">{shown.map((r) => {
          const o = r.order_id ? orders[r.order_id] : null, st = SEP_STATUS[r.status];
          const due = r.due_date || o?.due_date;
          return (
            <Link key={r.id} href={`/shop/separations/${r.id}`} className="sep-qi">
              <span className="sep-qt" style={{ background: r.garment_color ? undefined : "var(--surface-2)" }}>{thumbs[r.id] ? <img src={thumbs[r.id]} alt="" /> : <span className="faint">No art</span>}</span>
              <span className="sep-qb">
                <b>{o ? `#${o.number}` : `S-${r.number}`} · {r.location || "Imprint"}</b>
                <span>{cust[r.customer_id || ""] || ""}{o?.nickname ? ` · ${o.nickname}` : ""}</span>
                <small className="faint">{r.garment_color || "—"}{r.channels.length ? ` · ${r.channels.length} screen${r.channels.length === 1 ? "" : "s"}` : ""}{due ? ` · due ${fmtDate(due)}` : ""}</small>
              </span>
              <span className="pill" style={{ ["--sc" as string]: st.c }}>{st.label}</span>
            </Link>
          );
        })}</div>
      )}
    </>
  );
}
