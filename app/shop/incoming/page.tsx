"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useShopData, summaryLine } from "@/lib/shopData";
import { custLabel } from "@/lib/format";

/** Orders customers built in their portal and sent in, waiting for the shop to price and review. */
export default function Incoming() {
  const { orders, customers, loading } = useShopData();
  const router = useRouter();
  const [q, setQ] = useState("");
  const list = orders.filter((o) => o.status === "request")
    .filter((o) => { const t = q.trim().toLowerCase(); return !t || [o.number, o.nickname, custLabel(customers[o.customer_id || ""])].some((x) => String(x || "").toLowerCase().includes(t)); })
    .sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">From the customer portal</div><h1>Incoming orders</h1></div>
        <label className="aa-search"><input type="search" placeholder="Search by number, customer or name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>Customers build these without prices. Open one to check it, answer their questions, adjust the suggested pricing and send it back for their final approval.</p>
      {loading ? <div className="empty">Loading…</div> : (
        <div className="aa-card aa-tblcard">
          <table className="aa-tbl">
            <thead><tr><th>#</th><th>Customer</th><th>Order</th><th>Items</th><th className="r">Pieces</th><th>Sent in</th><th>Questions</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => router.push(`/shop/orders/${o.id}`)}>
                  <td className="num"><Link href={`/shop/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>{o.number}</Link></td>
                  <td><div className="aa-t">{custLabel(customers[o.customer_id || ""]) || "—"}</div><div className="aa-s">{customers[o.customer_id || ""]?.price_type === "wholesale" ? "Wholesale" : "Retail"}</div></td>
                  <td>{o.nickname || "Order request"}</td>
                  <td className="aa-s" style={{ maxWidth: 280 }}>{summaryLine(o)}</td>
                  <td className="r num">{o.qty}</td>
                  <td>{o.submitted_at ? new Date(o.submitted_at).toLocaleDateString() : "—"}</td>
                  <td>{o.unread ? <span className="aa-pill" style={{ ["--sc" as string]: "#D97706" }}>{o.unread} new</span> : <span className="faint">—</span>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7}><div className="aa-empty">{q ? `No matches for “${q}”.` : "No incoming orders right now."}</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
