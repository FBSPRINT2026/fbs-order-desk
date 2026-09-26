"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/pricing";
import { money } from "@/lib/format";
import { useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type APayment } from "@/components/AccountAreas";
import { fmtDateLong } from "@/lib/format";
import { previewUrls } from "@/lib/designs";
import { staffCustomerMessage } from "@/app/shop/actions";
import { archiveDesign, deleteDesign } from "@/app/artwork-actions";
import type { Design } from "@/lib/pricing";

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const isNew = useSearchParams().get("new") === "1";
  const { orders, customers, loading } = useShopData();
  const [c, setC] = useState<Customer | null>(null);
  const [state, setState] = useState("");
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Customer | null>(null);

  useEffect(() => { if (!c && customers[id]) setC(customers[id]); }, [customers, id, c]);

  // account areas: payments, artwork, messages for this customer
  const [payments, setPayments] = useState<APayment[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [designUrls, setDesignUrls] = useState<Record<string, string>>({});
  const [mockups, setMockups] = useState<AMockup[]>([]);
  const [messages, setMessages] = useState<AMessage[]>([]);
  const [pendingArt, setPendingArt] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [usedIds, setUsedIds] = useState<string[]>([]);
  const orderIds = orders.filter((o) => o.customer_id === id).map((o) => o.id).join(",");
  useEffect(() => {
    if (loading) return;
    const sb = createClient();
    const ids = orderIds ? orderIds.split(",") : [];
    const num = (oid: string | null) => orders.find((o) => o.id === oid)?.number ?? null;
    (async () => {
      const [p, d, m, msg, pr] = await Promise.all([
        ids.length ? sb.from("payments").select("*").in("order_id", ids).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
        sb.from("designs").select("*").eq("customer_id", id).order("number", { ascending: false }),
        sb.from("mockups").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
        sb.from("messages").select("*").or(ids.length ? `customer_id.eq.${id},order_id.in.(${ids.join(",")})` : `customer_id.eq.${id}`).order("created_at"),
        ids.length ? sb.from("proofs").select("order_id,created_at").in("order_id", ids).eq("status", "pending") : Promise.resolve({ data: [] }),
      ]);
      const pa: Record<string, string> = {};
      ((pr.data || []) as { order_id: string; created_at: string }[]).forEach((x) => { pa[x.order_id] = x.created_at; });
      setPendingArt(pa);
      setPayments(((p.data || []) as { id: string; order_id: string; amount: number; method: string; paid_on: string | null; created_at: string }[]).map((x) => ({ ...x, amount: +x.amount || 0, number: num(x.order_id) || 0 })));
      const dl = (d.data || []) as Design[];
      const { data: used } = await sb.rpc("designs_in_use", { p_customer: id });
      setUsedIds((used || []) as string[]);
      setDesigns(dl);
      setDesignUrls(await previewUrls(sb, dl));
      const ml = (m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string; starred?: boolean }[];
      const paths = ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]);
      const { data: signed } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
      setMockups(ml.map((x, i) => ({ id: x.id, title: x.title, starred: !!x.starred, order_id: x.order_id, number: num(x.order_id), created_at: x.created_at, url: signed?.[i * 2]?.signedUrl || "", thumb: signed?.[i * 2 + 1]?.signedUrl || signed?.[i * 2]?.signedUrl || "" })));
      setMessages(((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderIds, loading, reload]);

  async function save() {
    if (!latest.current) return;
    const { id: _id, created_at, ...rest } = latest.current;
    setState("Saving…");
    const { error } = await createClient().from("customers").update({ ...rest, email: rest.email.trim().toLowerCase(), contact2_email: (rest.contact2_email || "").trim().toLowerCase() }).eq("id", id);
    setState(error ? "Save failed: " + error.message : "Saved");
  }
  function set<K extends keyof Customer>(k: K, v: Customer[K]) {
    setC((prev) => {
      const n = { ...(prev as Customer), [k]: v };
      latest.current = n;
      return n;
    });
    setState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); save(); } }, []); // flush on leave

  async function newQuote() {
    const { data, error } = await createClient().from("orders").insert({ customer_id: id, tax_exempt: !!c?.tax_exempt, price_type: c?.price_type || "retail" }).select("id").single();
    if (data) router.push(`/shop/orders/${data.id}?new=1`);
    else if (error) alert(error.message);
  }

  const os = orders.filter((o) => o.customer_id === id);
  const spent = os.filter((o) => o.type === "invoice").reduce((a, o) => a + o.total, 0);
  const owed = os.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, o.balance), 0);

  async function del() {
    if (os.length) return;
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
    if (timer.current) clearTimeout(timer.current);
    await createClient().from("customers").delete().eq("id", id);
    router.push("/shop/customers");
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (!c) return <><Link className="back" href="/shop/customers">← Customers</Link><div className="empty">This customer doesn&apos;t exist.</div></>;

  return (
    <>
      <Link className="back" href="/shop/customers">← Customers</Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div><div className="eyebrow">Customer</div><h1>{c.company || c.name || "New customer"}</h1></div>
        <div className="row">
          <Link className="btn" href={`/shop/customers/${id}?area=details`} scroll={false}>Customer details</Link>
          <a className="btn" href={`/portal?as=${id}`} target="_blank" rel="noreferrer">View their portal</a>
          <button className="btn primary" type="button" onClick={newQuote}>+ New quote</button>
          <button className={"btn danger" + (armed ? " armed" : "")} type="button" onClick={del} disabled={os.length > 0} title={os.length ? "Delete this customer's orders first" : ""}>{armed ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
      <AccountAreas mode="shop" attention={os.flatMap((o): AAttn[] => {
          const out: AAttn[] = [];
          const d = (x?: string | null) => (x ? fmtDateLong(x.slice(0, 10)) : "");
          if (o.status === "quote_sent") out.push({ kind: "quote", order_id: o.id, number: o.number, date: d(o.created_at) });
          if (pendingArt[o.id]) out.push({ kind: "art", order_id: o.id, number: o.number, date: d(pendingArt[o.id]) });
          if (o.type === "invoice" && o.balance > 0.004) out.push({ kind: "pay", order_id: o.id, number: o.number, date: money(o.balance) });
          if (o.price_type === "wholesale" && o.type === "invoice" && ["approved", "art", "blanks"].includes(o.status)) out.push({ kind: "receive", order_id: o.id, number: o.number, date: d(o.due_date) || "—" });
          return out;
        })} orders={os.map((o) => ({ ...o, nickname: o.nickname || "", price_type: o.price_type }))} payments={payments} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
        hrefBase="/shop/orders/"
        onSend={async (body) => { const r = await staffCustomerMessage(id, body); if (r.ok) setReload((n) => n + 1); return r; }}
        usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign}
        onStarMockup={async (mid, starred) => { const { error } = await createClient().rpc("set_mockup_star", { p_mockup: mid, p_starred: starred }); return { ok: !error, error: error?.message }; }}
        onStar={async (designId, starred) => { const { error } = await createClient().rpc("set_design_star", { p_design: designId, p_starred: starred }); return { ok: !error, error: error?.message }; }}
        details={
      <div className="cust-grid">
          <form className="panel" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div className="panel-h"><h2>Details</h2><span className="faint" style={{ fontSize: 12 }}>{state || "Saves as you type"}</span></div>
            <div className="panel-b stack">
              <div className="field"><label htmlFor="cu-company">Company / organization</label><input autoFocus={isNew} type="text" id="cu-company" value={c.company} onChange={(e) => set("company", e.target.value)} /></div>
              <div className="field"><label htmlFor="cu-name">Contact name</label><input type="text" id="cu-name" value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-email">Email (their portal login)</label><input type="email" id="cu-email" value={c.email} onChange={(e) => set("email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-phone">Phone</label><input type="tel" id="cu-phone" value={c.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              </div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-address">Billing address</label><textarea id="cu-address" rows={3} value={c.address} onChange={(e) => set("address", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-ship">Ship-to address (if different)</label><textarea id="cu-ship" rows={3} value={c.ship_address || ""} onChange={(e) => set("ship_address", e.target.value)} /></div>
              </div>
              <div className="lbl" style={{ marginTop: 4 }}>Second contact (optional)</div>
              <div className="grid g3">
                <div className="field"><label htmlFor="cu-c2n">Name</label><input id="cu-c2n" type="text" value={c.contact2_name || ""} onChange={(e) => set("contact2_name", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2e">Email</label><input id="cu-c2e" type="email" value={c.contact2_email || ""} onChange={(e) => set("contact2_email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2p">Phone</label><input id="cu-c2p" type="tel" value={c.contact2_phone || ""} onChange={(e) => set("contact2_phone", e.target.value)} /></div>
              </div>
              <div className="field"><label htmlFor="cu-type">Customer type</label>
                <select id="cu-type" value={c.price_type || "retail"} onChange={(e) => set("price_type", e.target.value as Customer["price_type"])}>
                  <option value="retail">Retail: we supply the garments</option>
                  <option value="wholesale">Wholesale: they supply the garments (imprint pricing only)</option>
                </select>
              </div>
              <label className="check"><input type="checkbox" checked={c.tax_exempt} onChange={(e) => set("tax_exempt", e.target.checked)} /> Tax exempt (new quotes start exempt)</label>
              <div className="field"><label htmlFor="cu-notes">Notes (only your shop sees these)</label><textarea id="cu-notes" rows={3} placeholder="Preferred inks, art files, pickup details…" value={c.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
          </form>
          <div className="stack">
            <div className="stats" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", margin: 0 }}>
              <div className="stat" style={{ cursor: "default" }}><span className="v">{os.length}</span><span className="k">Orders</span></div>
              <div className="stat" style={{ cursor: "default" }}><span className="v">{money(spent)}</span><span className="k">Invoiced</span></div>
              <div className="stat" style={{ cursor: "default" }}><span className={"v" + (owed > 0.004 ? " alert" : "")}>{money(owed)}</span><span className="k">Balance owed</span></div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 520 }}>
                <thead><tr><th>#</th><th>Job</th><th>Status</th><th>Due</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {os.length ? os.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/shop/orders/${o.id}`)}><td><span className="ordno">{o.number}</span></td><td>{o.nickname || "Untitled job"}</td><td><Pill status={o.status} /></td><td><Due date={o.due_date} status={o.status} /></td><td className="r">{money(o.total)}</td></tr>
                  )) : <tr><td colSpan={5}><div className="empty">No orders for this customer yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          } />
    </>
  );
}
