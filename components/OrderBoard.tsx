"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ST, STATUSES, isMe, type StatusKey } from "@/lib/pricing";
import { custLabel, money } from "@/lib/format";
import { useShopData, type OrderRow } from "@/lib/shopData";
import { Due } from "@/components/bits";
import SearchInput from "@/components/SearchInput";

/**
 * Order pipeline (a sales tool, on the dashboard): one column per status, compact cards (order #, job, due,
 * customer, pieces, account owner), everyone's jobs or just the accounts you own (follows the dashboard's
 * Everyone / Mine switch when given), a search, and long columns trimmed with "Show all".
 * Drag a card (or use its → button) to move it along.
 */
const PER_COL = 6;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function OrderBoard({ mine: mineProp }: { mine?: boolean }) {
  const router = useRouter();
  const { orders, setOrders, customers, settings, loading } = useShopData();
  const [showQuotes, setShowQuotes] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [mineOwn, setMine] = useState(false);
  const mine = mineProp ?? mineOwn;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [me, setMe] = useState({ email: "", name: "" });
  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user?.email) return;
      const { data } = await sb.from("staff").select("name").eq("email", user.email.toLowerCase()).maybeSingle();
      setMe({ email: user.email.toLowerCase(), name: (data?.name as string) || "" });
    });
  }, []);

  const cols = STATUSES.filter((s) => showQuotes || s.type === "invoice");
  const owners = settings.accountOwners || [];
  const ownerOf = (o: OrderRow) => customers[o.customer_id || ""]?.account_owner || "";
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter((o) => (!mine || isMe(ownerOf(o), owners, me)) && (!t || `${o.number} ${o.nickname} ${custLabel(customers[o.customer_id || ""])} ${o.po_number || ""}`.toLowerCase().includes(t)));
  }, [orders, mine, q, customers, owners, me]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="ob">
      <div className="bd-bar">
        {mineProp === undefined && <div className="rv-seg" role="group" aria-label="Whose jobs">{([[false, "Everyone"], [true, "My accounts"]] as const).map(([k, l]) => <button key={l} type="button" className={mine === k ? "on" : ""} onClick={() => setMine(k)}>{l}</button>)}</div>}
        <SearchInput placeholder="Find a job: #, name, customer, PO…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="faint bd-count">{shown.filter((o) => cols.some((c) => c.k === o.status)).length} jobs{mine ? " on your accounts" : ""}</span>
        <span className="spacer" />
        <label className="check"><input type="checkbox" checked={showQuotes} onChange={(e) => setShowQuotes(e.target.checked)} /> Show quotes</label>
        <Link className="linkbtn" href="/shop/calendar">Due dates calendar</Link>
      </div>
      {msg && <div className="faint" style={{ marginBottom: 8 }} role="status">{msg}</div>}
      {loading ? <div className="empty">Loading…</div> : (
        <div className="board bd-compact" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}>
          {cols.map((s) => {
            let list = shown.filter((o) => o.status === s.k).sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
            if (s.k === "completed") list = list.sort((a, b) => (b.due_date || "").localeCompare(a.due_date || "")).slice(0, 12);
            const pcs = list.reduce((a, o) => a + (o.qty || 0), 0);
            const all = !!open[s.k] || !!q.trim();
            return (
              <section key={s.k} className={"col" + (over === s.k ? " drop" : "")} style={{ ["--sc" as string]: s.c }}
                onDragOver={(e) => { e.preventDefault(); setOver(s.k); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragId || e.dataTransfer.getData("text/plain"); if (id) move(id, s.k); }}>
                <div className="col-h"><b>{s.label}</b><span className="n">{list.length}</span><span className="sum">{pcs.toLocaleString()} pcs</span></div>
                <div className="col-b">
                  {list.length ? (all ? list : list.slice(0, PER_COL)).map((o) => <Card key={o.id} o={o} cust={custLabel(customers[o.customer_id || ""])} owner={ownerOf(o)} onOpen={() => router.push(`/shop/orders/${o.id}`)} onMove={move} setDragId={setDragId} dragging={dragId === o.id} />)
                    : <div className="col-empty">{s.k === "completed" ? "Finished jobs land here" : "Nothing here"}</div>}
                  {list.length > PER_COL && !q.trim() && <button type="button" className="bd-more" onClick={() => setOpen((x) => ({ ...x, [s.k]: !x[s.k] }))}>{open[s.k] ? "Show fewer" : `Show all ${list.length}`}</button>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ o, cust, owner, onOpen, onMove, setDragId, dragging }: { o: OrderRow; cust: string; owner: string; onOpen: () => void; onMove: (id: string, k: StatusKey) => void; setDragId: (id: string | null) => void; dragging: boolean }) {
  const idx = STATUSES.findIndex((s) => s.k === o.status);
  const nxt = STATUSES[idx + 1];
  const owes = o.type === "invoice" && o.balance > 0.004;
  return (
    <article className={"card-job cj" + (dragging ? " dragging" : "")} draggable tabIndex={0}
      title={`#${o.number} ${o.nickname || ""}\n${cust} · ${o.qty} pcs${owner ? `\nAccount: ${owner}` : ""}${owes ? `\nOwes ${money(o.balance)}` : ""}`}
      onDragStart={(e) => { setDragId(o.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); }}
      onDragEnd={() => setDragId(null)}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) onOpen(); }}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="cj-1">
        <span className="ordno">#{o.number}</span>{o.rush && <span className="cj-rush">Rush</span>}{o.unread > 0 && <span className="unread" title="Unread message" />}
        <span className="cj-t">{o.nickname || "Untitled Job"}</span>
      </div>
      <div className="cj-2">
        <span className="cj-due"><Due date={o.due_date} status={o.status} /></span>
        <span className="cj-c">{cust} · {o.qty} pcs{owes ? <b className="cj-owe"> · owes {money(o.balance)}</b> : null}</span>
        {owner && <span className="cj-own" title={owner}>{initials(owner)}</span>}
        {nxt && <button className="cj-adv" type="button" title={`Move to ${nxt.label}`} aria-label={`Move to ${nxt.label}`} onClick={() => onMove(o.id, nxt.k)}>→</button>}
      </div>
    </article>
  );
}
