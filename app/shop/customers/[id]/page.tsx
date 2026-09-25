"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/pricing";
import { money } from "@/lib/format";
import { useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";

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
          <a className="btn" href={`/portal?as=${id}`} target="_blank" rel="noreferrer">View their portal</a>
          <button className="btn primary" type="button" onClick={newQuote}>+ New quote</button>
          <button className={"btn danger" + (armed ? " armed" : "")} type="button" onClick={del} disabled={os.length > 0} title={os.length ? "Delete this customer's orders first" : ""}>{armed ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
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
    </>
  );
}
