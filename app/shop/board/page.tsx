"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ST, STATUSES, type StatusKey } from "@/lib/pricing";
import { custLabel, money } from "@/lib/format";
import { useShopData, type OrderRow } from "@/lib/shopData";
import { Due } from "@/components/bits";

export default function BoardPage() {
  const router = useRouter();
  const { orders, setOrders, customers, loading } = useShopData();
  const [showQuotes, setShowQuotes] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const cols = STATUSES.filter((s) => showQuotes || s.type === "invoice");

  async function move(id: string, k: StatusKey) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status === k) return;
    setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, status: k, type: ST[k].type } : x)));
    const sb = createClient();
    const { error } = await sb.from("orders").update({ status: k, type: ST[k].type }).eq("id", id);
    if (error) { setMsg("Couldn't move #" + o.number + ": " + error.message); return; }
    await sb.from("order_events").insert({ order_id: id, kind: "status", detail: k, actor: "shop" });
    setMsg(`#${o.number} moved to ${ST[k].label}`);
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Drag a card to change its status</div><h1>Production</h1></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={showQuotes} onChange={(e) => setShowQuotes(e.target.checked)} /> Show quotes</label>
          <Link className="btn" href="/shop/calendar">Calendar view</Link>
        </div>
      </div>
      {msg && <div className="faint" style={{ marginBottom: 10 }} role="status">{msg}</div>}
      {loading ? <div className="empty">Loading…</div> : (
        <div className="board">
          {cols.map((s) => {
            let list = orders.filter((o) => o.status === s.k).sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
            if (s.k === "completed") list = list.sort((a, b) => (b.due_date || "").localeCompare(a.due_date || "")).slice(0, 12);
            const pcs = list.reduce((a, o) => a + (o.qty || 0), 0);
            return (
              <section key={s.k} className={"col" + (over === s.k ? " drop" : "")} style={{ ["--sc" as string]: s.c }}
                onDragOver={(e) => { e.preventDefault(); setOver(s.k); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragId || e.dataTransfer.getData("text/plain"); if (id) move(id, s.k); }}>
                <div className="col-h"><b>{s.label}</b><span className="n">{list.length}</span><span className="sum">{pcs} pcs</span></div>
                <div className="col-b">
                  {list.length ? list.map((o) => <Card key={o.id} o={o} cust={custLabel(customers[o.customer_id || ""])} onOpen={() => router.push(`/shop/orders/${o.id}`)} onMove={move} setDragId={setDragId} dragging={dragId === o.id} />)
                    : <div className="col-empty">{s.k === "completed" ? "Finished jobs land here" : "Nothing here"}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Card({ o, cust, onOpen, onMove, setDragId, dragging }: { o: OrderRow; cust: string; onOpen: () => void; onMove: (id: string, k: StatusKey) => void; setDragId: (id: string | null) => void; dragging: boolean }) {
  const idx = STATUSES.findIndex((s) => s.k === o.status);
  const nxt = STATUSES[idx + 1];
  const paid = o.balance <= 0.004 && o.total > 0;
  return (
    <article className={"card-job" + (dragging ? " dragging" : "")} draggable tabIndex={0}
      onDragStart={(e) => { setDragId(o.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); }}
      onDragEnd={() => setDragId(null)}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) onOpen(); }}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="row"><span className="ordno">#{o.number}</span>{o.unread > 0 && <span className="unread" title="Unread message" />}<span className="spacer" /><Due date={o.due_date} status={o.status} /></div>
      <div className="t">{o.nickname || "Untitled job"}</div>
      <div className="meta"><span>{cust}</span><span>·</span><span>{o.qty} pcs</span></div>
      <div className="foot">
        {o.type === "invoice" ? (paid ? <span className="tag" style={{ color: "var(--ok)" }}>Paid</span> : <span className="tag">Owes {money(o.balance)}</span>) : <span className="tag">{money(o.total)}</span>}
        {nxt && <button className="btn sm ghost adv" type="button" title={`Move to ${nxt.label}`} onClick={() => onMove(o.id, nxt.k)}>{nxt.label} →</button>}
      </div>
    </article>
  );
}
