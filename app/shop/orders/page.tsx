"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { matches, orderSearchText, words } from "@/lib/search";
import { ARCHIVE_LIST_COLS, type ArchiveSummary } from "@/lib/archive";
import { fmtDateLong } from "@/lib/format";
import { useRouter } from "next/navigation";
import { STATUSES } from "@/lib/pricing";
import { custLabel, daysUntil, money } from "@/lib/format";
import { summaryLine, useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";
import AssistantStrip from "@/components/AssistantStrip";
import SearchInput from "@/components/SearchInput";
import { useSticky } from "@/lib/useSticky";

/** A Printavo status in our words, so the filters work on Printavo orders too. */
function pvStatus(a: { kind: string; status_name: string }): string {
  const s = (a.status_name || "").toLowerCase();
  if (/job completed|picked up|delivered|complete/.test(s)) return "completed";
  if (a.kind === "quote" || /^quote/.test(s)) return s.includes("paid") ? "approved" : "quote";
  if (/ship|ready to ship|delivery/.test(s)) return "ready";
  if (/blank|transfers ordered|goods/.test(s)) return "blanks";
  if (/art|proof/.test(s)) return "art";
  if (/ready for production|scheduling|pre production|holder|waiting on details/.test(s)) return "approved";
  return "production";
}

type F = "all" | "quotes" | "invoices" | "open" | "unpaid" | "messages";

export default function OrdersPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { orders, customers, loading, error } = useShopData();
  const [type, setType] = useSticky<F>("orders.type", "all");
  const [status, setStatus] = useSticky("orders.status", "");
  const [q, setQ] = useState("");

  // Printavo orders (read-only copies) are listed with everything else: every open one + the most recent ones;
  // searching reaches all of them
  const [pvAll, setPvAll] = useState<ArchiveSummary[]>([]);
  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("archived_orders").select(ARCHIVE_LIST_COLS).not("status_name", "in", '("Job Completed","Quote - Closed")').order("visual_id", { ascending: false }).limit(600),
      sb.from("archived_orders").select(ARCHIVE_LIST_COLS).order("visual_id", { ascending: false }).limit(300),
    ]).then(([a, b]) => {
      const seen = new Set<string>();
      setPvAll([...((a.data || []) as ArchiveSummary[]), ...((b.data || []) as ArchiveSummary[])].filter((x) => !seen.has(x.id) && !!seen.add(x.id)));
    });
  }, []);
  const stats = useMemo(() => {
    const quotes = orders.filter((o) => o.type === "quote");
    const active = orders.filter((o) => o.type === "invoice" && o.status !== "completed");
    const dueWeek = active.filter((o) => { const n = daysUntil(o.due_date); return n !== null && n <= 7; });
    const late = active.filter((o) => { const n = daysUntil(o.due_date); return n !== null && n < 0; }).length;
    const owed = orders.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, o.balance), 0);
    const unread = orders.reduce((a, o) => a + o.unread, 0);
    // jobs still being worked in Printavo count too (until go-live)
    const pvOpen = pvAll.filter((a) => a.kind === "invoice" && pvStatus(a) !== "completed");
    const pvQuotes = pvAll.filter((a) => pvStatus(a) === "quote");
    const pvDue = pvOpen.filter((a) => { const n = daysUntil(a.due_date); return n !== null && n <= 7; });
    const pvLate = pvOpen.filter((a) => { const n = daysUntil(a.due_date); return n !== null && n < 0; }).length;
    const pvOwed = pvAll.filter((a) => a.kind === "invoice").reduce((x, a) => x + Math.max(0, +a.balance || 0), 0);
    return { quotes: [...quotes, ...pvQuotes], quotesValue: quotes.reduce((a, o) => a + o.total, 0) + pvQuotes.reduce((x, a) => x + (+a.total || 0), 0), active: [...active, ...pvOpen], dueWeek: [...dueWeek, ...pvDue], late: late + pvLate, owed: owed + pvOwed, unread };
  }, [orders, pvAll]);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (type === "quotes" && o.type !== "quote") return false;
      if (type === "invoices" && o.type !== "invoice") return false;
      if (type === "open" && (o.type !== "invoice" || o.status === "completed")) return false;
      if (type === "unpaid" && (o.type !== "invoice" || o.balance <= 0.004)) return false;
      if (type === "messages" && !o.unread) return false;
      if (status && o.status !== status) return false;
      if (qq) {
        const c = customers[o.customer_id || ""];
        if (!matches(qq, o.number, o.nickname, o.po_number, c?.company, c?.name, c?.email, summaryLine(o), orderSearchText(o))) return false;
      }
      return true;
    });
  }, [orders, customers, type, status, q]);

  const [arch, setArch] = useState<ArchiveSummary[]>([]);
  useEffect(() => {
    const w = words(q);
    if (!w.length || w.join("").length < 2) { setArch([]); return; }
    const timer = setTimeout(async () => {
      const sb = createClient();
      const esc = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
      let byText = sb.from("archived_orders").select(ARCHIVE_LIST_COLS).order("order_date", { ascending: false }).limit(100);
      for (const x of w) byText = byText.ilike("search_staff", `%${esc(x)}%`);
      // customer names count too: orders of customers whose name matches every word
      const custIds = Object.values(customers).filter((c) => matches(q, c.company, c.name, c.email)).map((c) => c.id).slice(0, 50);
      const [a, b] = await Promise.all([
        byText,
        custIds.length ? sb.from("archived_orders").select(ARCHIVE_LIST_COLS).in("customer_id", custIds).order("order_date", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
      ]);
      const seen = new Set<string>();
      setArch([...((a.data || []) as ArchiveSummary[]), ...((b.data || []) as ArchiveSummary[])].filter((x) => !seen.has(x.id) && !!seen.add(x.id)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, customers]);
  const archShown = useMemo(() => {
    const qq = q.trim();
    const seen = new Set<string>();
    const pool = [...arch, ...(qq ? pvAll.filter((a) => matches(qq, a.visual_id, a.nickname, customers[a.customer_id]?.company, customers[a.customer_id]?.name)) : pvAll)].filter((x) => !seen.has(x.id) && !!seen.add(x.id));
    return pool.filter((a) => {
      const k = pvStatus(a);
      if (type === "quotes" && k !== "quote") return false;
      if (type === "invoices" && a.kind !== "invoice") return false;
      if (type === "open" && (a.kind !== "invoice" || k === "completed" || k === "quote")) return false;
      if (type === "unpaid" && (a.kind !== "invoice" || +a.balance <= 0.004)) return false;
      if (type === "messages") return false;
      if (status && k !== status) return false;
      return true;
    });
  }, [arch, pvAll, q, type, status, customers]);
  // one list, newest number first (Printavo and new orders share the numbering)
  const rows = useMemo(() => [
    ...list.map((o) => ({ n: o.number, o, a: null as ArchiveSummary | null })),
    ...archShown.map((a) => ({ n: +a.visual_id || 0, o: null as (typeof list)[number] | null, a })),
  ].sort((x, y) => y.n - x.n), [list, archShown]);

  const chips: [F, string][] = [["all", "All"], ["quotes", "Quotes"], ["invoices", "Invoices"], ["open", "In progress"], ["unpaid", "Unpaid"], ["messages", `Messages${stats.unread ? ` (${stats.unread})` : ""}`]];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1>Orders</h1>
        </div>
        <button className="btn primary" type="button" disabled={creating} onClick={async () => {
          setCreating(true);
          const { data, error } = await createClient().from("orders").insert({ lines: [], status: "quote", type: "quote" }).select("id").single();
          setCreating(false);
          if (!error && data) router.push(`/shop/orders/${data.id}?new=1`); else alert("Couldn't create the quote: " + (error?.message || ""));
        }}>{creating ? "Creating…" : "+ New quote"}</button>
      </div>
      {error && <div className="banner">Couldn&apos;t load orders: {error}</div>}
      <div className="stats">
        <button className="stat" type="button" onClick={() => { setType("quotes"); setStatus(""); }}><span className="v">{money(stats.quotesValue)}</span><span className="k">{stats.quotes.length} open quote{stats.quotes.length === 1 ? "" : "s"}</span></button>
        <button className="stat" type="button" onClick={() => { setType("open"); setStatus(""); }}><span className="v">{stats.active.length}</span><span className="k">Jobs in progress</span></button>
        <button className="stat" type="button" onClick={() => router.push("/shop/calendar")}><span className={"v" + (stats.late ? " alert" : "")}>{stats.dueWeek.length}</span><span className="k">Due within 7 days{stats.late ? ` · ${stats.late} late` : ""}</span></button>
        <button className="stat" type="button" onClick={() => { setType("unpaid"); setStatus(""); }}><span className="v">{money(stats.owed)}</span><span className="k">Balance outstanding</span></button>
      </div>
      <AssistantStrip />
      <div className="toolbar">
        <div className="chips">
          {chips.map(([k, l]) => <button key={k} className={"chip" + (type === k ? " on" : "")} type="button" onClick={() => setType(k)}>{l}</button>)}
        </div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <SearchInput placeholder="Search #, customer, garment, color, print details… (includes Printavo orders)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Job</th><th>Customer</th><th>Status</th><th>Due</th><th className="r">Pcs</th><th className="r">Total</th><th className="r">Balance</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}><div className="empty">Loading…</div></td></tr>
            ) : rows.length ? rows.map(({ o, a }) => {
              if (o) {
                const c = customers[o.customer_id || ""];
                const paid = o.balance <= 0.004 && o.total > 0;
                return (
                  <tr key={o.id} tabIndex={0} onClick={() => router.push(`/shop/orders/${o.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/shop/orders/${o.id}`)}>
                    <td><span className="ordno">{o.number}</span> <span className={"tag " + (o.type === "quote" ? "q" : "i")}>{o.type === "quote" ? "Quote" : "Inv"}</span>{o.unread > 0 && <span className="unread" title="Unread customer message" />}</td>
                    <td><div>{o.nickname || "Untitled Job"}{o.rush && <span className="tag" style={{ marginLeft: 6, background: "var(--danger)", color: "#fff" }}>Rush</span>}</div><div className="sub">{summaryLine(o)}{o.po_number ? ` · PO ${o.po_number}` : ""}</div></td>
                    <td><div>{custLabel(c)}</div><div className="sub">{c?.company ? c.name : ""}</div></td>
                    <td><Pill status={o.status} /></td>
                    <td><Due date={o.due_date} status={o.status} /></td>
                    <td className="r">{o.qty}</td>
                    <td className="r">{money(o.total)}</td>
                    <td className="r"><span className={"bal" + (paid ? " paid" : "")}>{paid ? "Paid" : money(o.balance)}</span></td>
                  </tr>
                );
              }
              const c = customers[a!.customer_id];
              return (
                <tr key={a!.id} tabIndex={0} onClick={() => router.push(`/shop/archive/${a!.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/shop/archive/${a!.id}`)}>
                  <td><span className="ordno">{a!.visual_id}</span> <span className={"tag " + (a!.kind === "quote" ? "q" : "i")}>{a!.kind === "quote" ? "Quote" : "Inv"}</span></td>
                  <td><div>{a!.nickname || "Untitled Job"}<span className="aa-arch">Printavo</span></div><div className="sub">{a!.order_date ? fmtDateLong(a!.order_date) : ""}</div></td>
                  <td><div>{custLabel(c)}</div><div className="sub">{c?.company ? c.name : ""}</div></td>
                  <td><span className="pv-dot" style={{ ["--sc" as string]: a!.status_color || "#888" }}>{a!.status_name}</span></td>
                  <td>{pvStatus(a!) === "completed" ? (a!.due_date ? fmtDateLong(a!.due_date) : "—") : <Due date={a!.due_date} status="production" />}</td>
                  <td className="r">{a!.qty}</td>
                  <td className="r">{money(a!.total)}</td>
                  <td className="r"><span className={"bal" + (+a!.balance <= 0.004 ? " paid" : "")}>{+a!.balance <= 0.004 ? "Paid" : money(a!.balance)}</span></td>
                </tr>
              );
            }) : (
              <tr><td colSpan={8}><div className="empty">{orders.length || pvAll.length ? "No orders match these filters." : "No orders yet. Start with + New quote."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
