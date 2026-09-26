"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { designLabel, orderGroups, type Customer, type Design, type Order } from "@/lib/pricing";
import { custLabel, fmtDate } from "@/lib/format";
import { setDesignPreview } from "@/lib/designs";

/** One design: preview, details, original file, and every order it's been used on. */
export default function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [d, setD] = useState<Design | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pv, setPv] = useState("");
  const [orig, setOrig] = useState("");
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);

  async function load() {
    const { data } = await sb.from("designs").select("*").eq("id", id).maybeSingle();
    if (!data) return setMsg("Design not found.");
    const des = data as Design;
    setD(des);
    const paths = [des.preview_path, des.file_path].filter(Boolean);
    const { data: urls } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    setPv(des.preview_path ? urls?.[0]?.signedUrl || "" : "");
    setOrig(urls?.[des.preview_path ? 1 : 0]?.signedUrl || "");
    const [c, o] = await Promise.all([
      sb.from("customers").select("*"),
      des.customer_id ? sb.from("orders").select("*").eq("customer_id", des.customer_id).order("number", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    setCustomers(((c.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
    setOrders(((o.data || []) as Order[]).filter((x) => orderGroups(x).some((g) => g.imprints.some((im) => im.design_id === des.id))));
  }
  useEffect(() => { load(); }, [id]);

  async function patch(p: Partial<Design>) {
    if (!d) return;
    setD({ ...d, ...p });
    const { error } = await sb.from("designs").update(p).eq("id", d.id);
    setMsg(error ? "Couldn't save: " + error.message : "Saved");
  }
  async function del() {
    if (!d) return;
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
    await sb.storage.from("proofs").remove([d.file_path, d.preview_path].filter((x, i, a) => x && a.indexOf(x) === i));
    await sb.from("designs").delete().eq("id", d.id);
    router.push("/shop/artwork");
  }

  if (!d) return <div className="empty">{msg || "Loading…"}</div>;
  const ratio = d.width_px && d.height_px ? d.height_px / d.width_px : 0;
  return (
    <>
      <Link className="back" href="/shop/artwork">← Artwork</Link>
      <div className="page-head">
        <div><div className="eyebrow">{custLabel(customers.find((c) => c.id === d.customer_id)) || "No customer"}</div><h1>{designLabel(d)}</h1></div>
        <div className="row"><span className="save-state">{msg}</span>{orig && <a className="btn" href={orig} target="_blank" rel="noreferrer">Download original</a>}<button className={"btn ghost danger" + (armed ? " armed" : "")} type="button" onClick={del}>{armed ? "Delete design?" : "Delete"}</button></div>
      </div>
      <div className="cust-grid">
        <section className="panel">
          <div className="panel-b stack">
            <div className="dc-img" style={{ aspectRatio: "1 / 1", borderRadius: 6 }}>{pv ? <img src={pv} alt={d.name} /> : <span>No preview</span>}</div>
            <label className="btn" style={{ cursor: "pointer", alignSelf: "flex-start" }}>{pv ? "Replace preview image" : "Add preview image"}<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setD(await setDesignPreview(sb, d, f)); setMsg("Preview updated"); load(); } catch (er) { setMsg(String(er)); } }} /></label>
            <div className="sub">Original: {d.file_name || "—"}{ratio ? ` · proportions ${(1).toFixed(0)} : ${ratio.toFixed(2)} (width : height)` : ""}</div>
          </div>
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Details</h2></div>
            <div className="panel-b grid g2">
              <div className="field"><label htmlFor="d-n">Name</label><input id="d-n" type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} /></div>
              <div className="field"><label htmlFor="d-c">Customer</label><select id="d-c" value={d.customer_id || ""} onChange={(e) => patch({ customer_id: e.target.value || null })}><option value="">No customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select></div>
              <div className="field"><label htmlFor="d-k">Ink colors</label><input id="d-k" type="number" min="1" max="15" value={d.colors} onChange={(e) => patch({ colors: Math.max(1, +e.target.value || 1) })} /></div>
              <div className="field"><label htmlFor="d-i">Inks / PMS</label><input id="d-i" type="text" value={d.inks} onChange={(e) => setD({ ...d, inks: e.target.value })} onBlur={(e) => patch({ inks: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="d-no">Notes</label><textarea id="d-no" rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={(e) => patch({ notes: e.target.value })} /></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Used on</h2></div>
            <div className="panel-b stack">
              {orders.length ? orders.map((o) => (
                <Link key={o.id} href={`/shop/orders/${o.id}`} className="pay-row" style={{ textDecoration: "none", color: "inherit" }}>
                  <span>#{o.number} {o.nickname}</span>
                  <span className="faint">{orderGroups(o).flatMap((g) => g.imprints.filter((im) => im.design_id === d.id).map((im) => im.location)).join(", ")} · {fmtDate(o.created_at?.slice(0, 10))}</span>
                </Link>
              )) : <div className="faint" style={{ fontSize: 13 }}>Not on any orders yet. Pick it for an imprint on an order.</div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
