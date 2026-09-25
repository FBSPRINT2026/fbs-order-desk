"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { STATUSES } from "@/lib/pricing";
import { custLabel, daysUntil, money } from "@/lib/format";
import { summaryLine, useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";

type F = "all" | "quotes" | "invoices" | "open" | "unpaid" | "messages";

export default function OrdersPage() {
  const router = useRouter();
  const { orders, customers, loading, error } = useShopData();
  const [type, setType] = useState<F>("all");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    const quotes = orders.filter((o) => o.type === "quote");
    const active = orders.filter((o) => o.type === "invoice" && o.status !== "completed");
    const dueWeek = active.filter((o) => { const n = daysUntil(o.due_date); return n !== null && n <= 7; });
    const late = active.filter((o) => { const n = daysUntil(o.due_date); return n !== null && n < 0; }).length;
    const owed = orders.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, o.balance), 0);
    const unread = orders.reduce((a, o) => a + o.unread, 0);
    return { quotes, quotesValue: quotes.reduce((a, o) => a + o.total, 0), active, dueWeek, late, owed, unread };
  }, [orders]);

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
        const hay = [o.number, o.nickname, c?.company, c?.name, c?.email, summaryLine(o)].join(" ").toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [orders, customers, type, status, q]);

  const chips: [F, string][] = [["all", "All"], ["quotes", "Quotes"], ["invoices", "Invoices"], ["open", "In progress"], ["unpaid", "Unpaid"], ["messages", `Messages${stats.unread ? ` (${stats.unread})` : ""}`]];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1>Orders</h1>
        </div>
      </div>
      {error && <div className="banner">Couldn&apos;t load orders: {error}</div>}
      <div className="stats">
        <button className="stat" type="button" onClick={() => { setType("quotes"); setStatus(""); }}><span className="v">{money(stats.quotesValue)}</span><span className="k">{stats.quotes.length} open quote{stats.quotes.length === 1 ? "" : "s"}</span></button>
        <button className="stat" type="button" onClick={() => { setType("open"); setStatus(""); }}><span className="v">{stats.active.length}</span><span className="k">Jobs in progress</span></button>
        <button className="stat" type="button" onClick={() => router.push("/shop/calendar")}><span className={"v" + (stats.late ? " alert" : "")}>{stats.dueWeek.length}</span><span className="k">Due within 7 days{stats.late ? ` · ${stats.late} late` : ""}</span></button>
        <button className="stat" type="button" onClick={() => { setType("unpaid"); setStatus(""); }}><span className="v">{money(stats.owed)}</span><span className="k">Balance outstanding</span></button>
      </div>
      <div className="toolbar">
        <div className="chips">
          {chips.map(([k, l]) => <button key={k} className={"chip" + (type === k ? " on" : "")} type="button" onClick={() => setType(k)}>{l}</button>)}
        </div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <input type="search" placeholder="Search #, customer, garment…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Job</th><th>Customer</th><th>Status</th><th>Due</th><th className="r">Pcs</th><th className="r">Total</th><th className="r">Balance</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}><div className="empty">Loading…</div></td></tr>
            ) : list.length ? list.map((o) => {
              const c = customers[o.customer_id || ""];
              const paid = o.balance <= 0.004 && o.total > 0;
              return (
                <tr key={o.id} tabIndex={0} onClick={() => router.push(`/shop/orders/${o.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/shop/orders/${o.id}`)}>
                  <td><span className="ordno">{o.number}</span> <span className={"tag " + (o.type === "quote" ? "q" : "i")}>{o.type === "quote" ? "Quote" : "Inv"}</span>{o.unread > 0 && <span className="unread" title="Unread customer message" />}</td>
                  <td><div>{o.nickname || "Untitled job"}</div><div className="sub">{summaryLine(o)}</div></td>
                  <td><div>{custLabel(c)}</div><div className="sub">{c?.company ? c.name : ""}</div></td>
                  <td><Pill status={o.status} /></td>
                  <td><Due date={o.due_date} status={o.status} /></td>
                  <td className="r">{o.qty}</td>
                  <td className="r">{money(o.total)}</td>
                  <td className="r"><span className={"bal" + (paid ? " paid" : "")}>{paid ? "Paid" : money(o.balance)}</span></td>
                </tr>
              );
            }) : (
              <tr><td colSpan={8}><div className="empty">{orders.length ? "No orders match these filters." : "No orders yet. Start with + New quote."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
