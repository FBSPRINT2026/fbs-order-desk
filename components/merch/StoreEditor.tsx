"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStore, saveStore, setStoreStatus, uploadStoreImage, type StoreBundle } from "@/app/merch-actions";
import { DEFAULT_FIELDS, STORE_STEPS, fmtDate, fmtDateTime, orderCode, r2, slugify, stepOf, storeImg, type Field, type Store, type StoreStatus } from "@/lib/merch";
import { useSticky } from "@/lib/useSticky";
import ProductsTab from "@/components/merch/ProductsTab";
import { GoodsTab, OrdersTab, PackingTab, ReportTab } from "@/components/merch/OrdersTabs";

const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
export type Tab = "overview" | "setup" | "products" | "orders" | "goods" | "packing" | "report";

/** One merch store: overview + next step, setup, products, orders, goods, packing, give-back report. Shop and portal. */
export default function StoreEditor({ id, base }: { id: string; base: string }) {
  const [b, setB] = useState<StoreBundle | null>(null), [err, setErr] = useState("");
  const [tab, setTab] = useSticky<Tab>("store.tab", "overview");
  const load = useCallback(async () => { const r = await getStore(id); if (!r.ok) setErr(r.error); else setB(r.data); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="pv-err">{err} <Link href={base}>Back to stores</Link></div>;
  if (!b) return <div className="empty">Loading…</div>;
  const st = b.store;
  const tabs: [Tab, string][] = b.staff
    ? [["overview", "Overview"], ["setup", "Setup"], ["products", `Products (${b.products.filter((p) => p.active).length})`], ["orders", `Orders (${b.orders.filter((o) => o.status !== "cancelled").length})`], ["goods", "Goods"], ["packing", "Packing"], ["report", "Give-back"]]
    : [["overview", "Overview"], ["setup", "Setup"], ["products", "Products"], ["orders", "Orders"], ["report", "Give-back"]];
  const cur = tabs.some(([k]) => k === tab) ? tab : "overview";
  const url = typeof window !== "undefined" ? `${location.origin}/s/${st.slug}` : `/s/${st.slug}`;
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow"><Link href={base}>Merch Stores</Link>{b.customer ? <> · {b.customer.name}</> : null}</div><h1 data-notranslate>{st.name}</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pill" style={{ ["--sc" as string]: "#1E9D5B" }}>{stepOf(st.status).label}</span>
          <a className="btn" href={`/s/${st.slug}`} target="_blank" rel="noreferrer">View store</a>
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(url)} title={url}>Copy link</button>
        </div>
      </div>
      <div className="aa-sub" role="tablist" style={{ marginBottom: 14 }}>
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {cur === "overview" && <Overview b={b} reload={load} go={setTab} />}
      {cur === "setup" && <Setup b={b} onSaved={(s) => setB({ ...b, store: s })} />}
      {cur === "products" && <ProductsTab b={b} reload={load} />}
      {cur === "orders" && <OrdersTab b={b} reload={load} />}
      {cur === "goods" && <GoodsTab b={b} reload={load} />}
      {cur === "packing" && <PackingTab b={b} reload={load} />}
      {cur === "report" && <ReportTab b={b} />}
    </>
  );
}

/* ------------------------------------------------------------------ overview */

const NEXT: Partial<Record<StoreStatus, { to: StoreStatus; label: string; hint: string }>> = {
  draft: { to: "open", label: "Open the store", hint: "Shoppers can order once it's open (until the close date)." },
  review: { to: "open", label: "Approve and open", hint: "The customer built this store and sent it to us to check." },
  open: { to: "closed", label: "Close the store now", hint: "It closes on its own at the close date." },
  closed: { to: "ordered", label: "Goods ordered", hint: "Order the blanks (Goods tab), then mark them ordered. Shoppers can't change their orders after this." },
  ordered: { to: "production", label: "In production", hint: "It's on the press." },
  production: { to: "packing", label: "Start packing", hint: "Printed: pack each order in its own bag (Packing tab)." },
  packing: { to: "ready", label: "All packed: ready", hint: "Every bag is packed and sorted. Next: set up delivery with the contact." },
  ready: { to: "delivered", label: "Delivered", hint: "Dropped off at the school / picked up / shipped." },
};

function Overview({ b, reload, go }: { b: StoreBundle; reload: () => void; go: (t: Tab) => void }) {
  const st = b.store;
  const live = b.orders.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status));
  const pcs = live.reduce((a, o) => a + (o.items || []).reduce((x, i) => x + i.qty, 0), 0);
  const sales = r2(live.reduce((a, o) => a + +o.total, 0)), give = r2(live.reduce((a, o) => a + +o.giveback, 0));
  const goal = +(st.giveback?.goal || 0);
  const [notify, setNotify] = useState(st.settings?.notify ?? true);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const next = NEXT[st.status];
  const custNext = !b.staff && st.status === "draft" ? { to: (b.selfLaunch ? "open" : "review") as StoreStatus, label: b.selfLaunch ? "Launch the store" : "Send to FBS Print to check", hint: b.selfLaunch ? "It opens right away for shoppers." : "FBS Print looks it over and opens it." } : null;
  const step = b.staff ? next : custNext;
  const flow = STORE_STEPS.filter((s) => !["review", "archived"].includes(s.k));
  const at = flow.findIndex((s) => s.k === (st.status === "review" ? "draft" : st.status));
  const best = Object.entries(live.flatMap((o) => o.items || []).reduce((m, i) => ({ ...m, [i.name]: (m[i.name] || 0) + i.qty }), {} as Record<string, number>)).sort((a, c) => c[1] - a[1]).slice(0, 6);
  const move = async (to: StoreStatus) => {
    setBusy(true); setMsg(null);
    const r = await setStoreStatus(st.id, to, { notify });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `${stepOf(to).label}.${r.data.emailed ? ` Emailed ${r.data.emailed} shopper${r.data.emailed === 1 ? "" : "s"}.` : ""}` });
    reload();
  };
  const emailsFor: StoreStatus[] = ["ordered", "production", "ready", "delivered"];
  const contact = st.contact || {};
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="panel"><div className="panel-b">
        <ol className="ms-flow">{flow.map((s, i) => <li key={s.k} className={i < at ? "done" : i === at ? "now" : ""}><span>{i < at ? "✓" : i + 1}</span>{s.label}</li>)}</ol>
        {step && (
          <div className="ms-next">
            <div><b>Next: {step.label}</b><div className="faint">{step.hint}</div>
              {b.staff && emailsFor.includes(step.to) && <label className="row" style={{ gap: 6, fontSize: 13, marginTop: 6 }}><input type="checkbox" style={{ width: "auto" }} checked={notify} onChange={(e) => setNotify(e.target.checked)} />Email every shopper about this step</label>}
            </div>
            <button type="button" className="btn primary" disabled={busy} onClick={() => move(step.to)}>{busy ? "Saving…" : step.label}</button>
          </div>
        )}
        {st.status === "closed" && b.staff && <div className="faint" style={{ marginTop: 8 }}>Order the blanks from the <button type="button" className="linkbtn" onClick={() => go("goods")}>Goods tab</button>.</div>}
        {st.status === "ready" && contact.email && (
          <div className="ms-next" style={{ marginTop: 10 }}>
            <div><b>Set up delivery with {contact.name || "the contact"}</b><div className="faint">Ask when and where: courier to the school, or they pick up.</div></div>
            <a className="btn" href={`mailto:${contact.email}?subject=${encodeURIComponent(`${st.name}: your orders are ready`)}&body=${encodeURIComponent(`Hi ${contact.name || ""},\n\nGreat news: all ${live.length} orders from ${st.name} are printed and packed, each in its own labeled bag, sorted by ${((st.fields || []) as Field[]).filter((f) => f.sort >= 0).sort((a, c) => a.sort - c.sort).map((f) => f.label.toLowerCase()).join(" and ") || "student"}.\n\nWhen works to get them to you? We can deliver to ${st.delivery?.org?.label || st.brand?.school || "the school"} (let us know a day and time), or you can pick them up at FBS Print.\n\nThank you!\nFBS Print`)}`}>Email {contact.name || "them"}</a>
          </div>
        )}
        {msg && <div className={msg.ok ? "okmsg" : "pv-err"} style={{ marginTop: 10 }}>{msg.text}</div>}
        {b.staff && st.status !== "draft" && <div style={{ marginTop: 8 }}><select className="ms-back" value="" onChange={(e) => { if (e.target.value) move(e.target.value as StoreStatus); }} aria-label="Move the store to another step"><option value="">Move to another step…</option>{STORE_STEPS.filter((s) => s.k !== st.status).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></div>}
      </div></div>

      <div className="ms-stats">
        <div><span>Orders</span><b>{live.length}</b></div>
        <div><span>Pieces</span><b>{pcs}</b></div>
        <div><span>Sales</span><b>{money(sales)}</b></div>
        <div><span>Give-back</span><b>{money(give)}</b>{goal > 0 && <><i className="ms-bar"><i style={{ width: `${Math.min(100, (give / goal) * 100)}%` }} /></i><small>{Math.round((give / goal) * 100)}% of the {money(goal)} goal</small></>}</div>
      </div>

      <div className="grid g2">
        <div className="panel"><div className="panel-h"><b>Store</b></div><div className="panel-b stack" style={{ gap: 6, fontSize: 14 }}>
          <div>Link: <a href={`/s/${st.slug}`} target="_blank" rel="noreferrer">/s/{st.slug}</a>{st.password ? <span className="faint"> · password “{st.password}”</span> : null}</div>
          <div>Opens: {st.opens_at ? fmtDateTime(st.opens_at) : "when you open it"}</div>
          <div>Closes: {st.closes_at ? fmtDateTime(st.closes_at) : <b style={{ color: "var(--danger)" }}>not set</b>}</div>
          <div>Delivered around: {st.deliver_by ? fmtDate(st.deliver_by) : <span className="faint">not set (shoppers see no date)</span>}</div>
          <div>Contact: {contact.name || "—"}{contact.email ? ` · ${contact.email}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}</div>
          {b.job && <div>Production job: <Link href={`/shop/orders/${b.job.id}`}>#{b.job.number}</Link></div>}
        </div></div>
        <div className="panel"><div className="panel-h"><b>Best sellers</b></div><div className="panel-b">
          {best.length ? <table className="ms-mini"><tbody>{best.map(([n, q]) => <tr key={n}><td>{n}</td><td className="r">{q}</td></tr>)}</tbody></table> : <div className="faint">No orders yet.</div>}
        </div></div>
      </div>

      <div className="panel"><div className="panel-h"><b>History</b></div><div className="panel-b">
        <ul className="ms-time">{[...(st.timeline || [])].reverse().map((e, i) => <li key={i}><b>{stepOf(e.status as StoreStatus)?.label || e.status}</b> <span className="faint">{fmtDateTime(e.at)} · {e.by}{e.note ? ` · ${e.note}` : ""}</span></li>)}</ul>
        {live.slice(-5).reverse().map((o) => <div key={o.id} className="faint" style={{ fontSize: 13 }}>{orderCode(st, o.number)} · {o.answers?.student || o.shopper.name} · {money(o.total)} · {fmtDateTime(o.created_at)}</div>)}
      </div></div>
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

const local = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const iso = (v: string) => (v ? new Date(v).toISOString() : null);

function Setup({ b, onSaved }: { b: StoreBundle; onSaved: (s: Store) => void }) {
  const [s, setS] = useState<Store>(b.store);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(b.store);
  const set = <K extends keyof Store>(k: K, v: Store[K]) => setS((x) => ({ ...x, [k]: v }));
  const brand = (k: keyof Store["brand"], v: string) => setS((x) => ({ ...x, brand: { ...x.brand, [k]: v } }));
  const locked = !b.staff && !["draft", "review"].includes(b.store.status);
  const fields = (s.fields?.length ? s.fields : DEFAULT_FIELDS) as Field[];
  const setField = (i: number, f: Partial<Field>) => set("fields", fields.map((x, j) => (j === i ? { ...x, ...f } : x)));
  async function upload(kind: "logo" | "banner", f: File | undefined) {
    if (!f) return;
    const fd = new FormData(); fd.set("store", s.id); fd.set("kind", kind); fd.set("file", f);
    const r = await uploadStoreImage(fd);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    brand(kind, r.data.path);
  }
  async function save() {
    setBusy(true); setMsg(null);
    const r = await saveStore(s.id, { ...s, fields });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setS(r.data); onSaved(r.data); setMsg({ ok: true, text: "Saved." });
  }
  return (
    <div className="stack" style={{ gap: 14, paddingBottom: 70 }}>
      <div className="panel"><div className="panel-h"><b>Store and dates</b><span className="faint">Shoppers see the close and delivery dates everywhere: it&apos;s a pre-order.</span></div><div className="panel-b grid g2">
        <div className="field"><label>Store name</label><input value={s.name} onChange={(e) => set("name", e.target.value)} /></div>
        {b.staff ? <div className="field"><label>Link</label><div className="row" style={{ gap: 4 }}><span className="faint">/s/</span><input value={s.slug} onChange={(e) => set("slug", slugify(e.target.value))} /></div></div> : <div className="field"><label>Link</label><div>/s/{s.slug}</div></div>}
        <div className="field"><label>Opens</label><input type="datetime-local" disabled={locked} value={local(s.opens_at)} onChange={(e) => set("opens_at", iso(e.target.value))} /><small className="faint">Blank: as soon as it&apos;s opened.</small></div>
        <div className="field"><label>Closes</label><input type="datetime-local" value={local(s.closes_at)} onChange={(e) => set("closes_at", iso(e.target.value))} /><small className="faint">It closes on its own at this time.</small></div>
        <div className="field"><label>Delivered around</label><input type="date" disabled={!b.staff} value={s.deliver_by || ""} onChange={(e) => set("deliver_by", e.target.value || null)} /><small className="faint">{b.staff ? "Shown to shoppers. Usually 10–14 business days after it closes." : "FBS Print sets this."}</small></div>
        <div className="field"><label>Store password (optional)</label><input value={s.password} onChange={(e) => set("password", e.target.value)} placeholder="Leave blank for an open link" /></div>
        <div className="field" style={{ gridColumn: "1/-1" }}><label>Welcome message</label><textarea rows={3} value={s.welcome} onChange={(e) => set("welcome", e.target.value)} placeholder="Show your Wolf pride! Every purchase gives back to the Whitt PTA." /></div>
      </div></div>

      <div className="panel"><div className="panel-h"><b>The school&apos;s look</b><span className="faint">The store looks like the school, not like FBS. “Fulfilled by FBS Print” is in the footer.</span></div><div className="panel-b">
        <div className="grid g2">
          <div className="field"><label>School / group name (the big banner)</label><input value={s.brand?.school || ""} onChange={(e) => brand("school", e.target.value)} /></div>
          <div className="field"><label>Mascot / line under it</label><input value={s.brand?.tagline || ""} onChange={(e) => brand("tagline", e.target.value)} placeholder="Home of the Wolves" /></div>
          <div className="field"><label>Main color</label><div className="row" style={{ gap: 8 }}><input type="color" style={{ width: 54, padding: 2 }} value={s.brand?.primary || "#1F3A8A"} onChange={(e) => brand("primary", e.target.value)} /><input value={s.brand?.primary || ""} onChange={(e) => brand("primary", e.target.value)} placeholder="#1F3A8A" /></div></div>
          <div className="field"><label>Second color</label><div className="row" style={{ gap: 8 }}><input type="color" style={{ width: 54, padding: 2 }} value={s.brand?.accent || "#F2B705"} onChange={(e) => brand("accent", e.target.value)} /><input value={s.brand?.accent || ""} onChange={(e) => brand("accent", e.target.value)} placeholder="#F2B705" /></div></div>
          <div className="field"><label>Logo</label><div className="row" style={{ gap: 8 }}>{s.brand?.logo && <img src={storeImg(s.brand.logo)} alt="" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8, background: "#fff", border: "1px solid var(--line)" }} />}<input type="file" accept="image/*" onChange={(e) => upload("logo", e.target.files?.[0])} /></div></div>
          <div className="field"><label>Banner photo (optional)</label><div className="row" style={{ gap: 8 }}>{s.brand?.banner && <img src={storeImg(s.brand.banner)} alt="" style={{ width: 80, height: 44, objectFit: "cover", borderRadius: 8 }} />}<input type="file" accept="image/*" onChange={(e) => upload("banner", e.target.files?.[0])} /></div></div>
        </div>
        <div className="ms-preview" style={{ ["--c" as string]: s.brand?.primary || "#1F3A8A", ["--a" as string]: s.brand?.accent || "#F2B705" }}>
          {s.brand?.logo && <img src={storeImg(s.brand.logo)} alt="" />}<div><b>{s.brand?.school || s.name}</b><span>{s.brand?.school ? s.name : s.brand?.tagline}</span></div>
        </div>
      </div></div>

      <div className="panel"><div className="panel-h"><b>Checkout questions</b><span className="faint">Bags are labeled with these and sorted by them for hand-out. Use lists (not typing) wherever you can.</span></div><div className="panel-b stack" style={{ gap: 10 }}>
        {locked && <div className="faint">The store is open, so the questions are locked.</div>}
        {fields.map((f, i) => (
          <div key={i} className="ms-q">
            <div className="field"><label>Question</label><input disabled={locked} value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: f.key || slugify(e.target.value).replace(/-/g, "_") })} /></div>
            <div className="field"><label>Answer</label><select disabled={locked} value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as Field["kind"] })}><option value="select">Pick from a list</option><option value="text">Type it in</option></select></div>
            {f.kind === "select" && <div className="field" style={{ gridColumn: "1/-1" }}><label>The list (one per line){f.key === "teacher" ? ": the PTA's homeroom teachers" : ""}</label><textarea disabled={locked} rows={Math.min(8, Math.max(2, f.options.length + 1))} value={f.options.join("\n")} onChange={(e) => setField(i, { options: e.target.value.split("\n") })} placeholder={f.key === "teacher" ? "Mrs. Bernal\nMr. Knott\nMs. Sadowski" : "One choice per line"} /></div>}
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" style={{ width: "auto" }} disabled={locked} checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />Required</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>Pack sort<select disabled={locked} style={{ width: "auto" }} value={f.sort} onChange={(e) => setField(i, { sort: +e.target.value })}><option value={-1}>not sorted</option>{fields.map((_, j) => <option key={j} value={j}>{j + 1}{j === 0 ? "st" : j === 1 ? "nd" : j === 2 ? "rd" : "th"}</option>)}</select></label>
            {!locked && <button type="button" className="linkbtn danger" onClick={() => set("fields", fields.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {!locked && <div><button type="button" className="btn sm" onClick={() => set("fields", [...fields, { key: `q${fields.length}`, label: "", kind: "text", options: [], required: false, sort: -1 }])}>+ Add a question</button></div>}
      </div></div>

      <div className="panel"><div className="panel-h"><b>How shoppers get their order</b></div><div className="panel-b stack" style={{ gap: 10 }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: "auto" }} disabled={locked} checked={!!s.delivery?.org?.on} onChange={(e) => set("delivery", { ...s.delivery, org: { ...s.delivery.org, on: e.target.checked } })} /><b>Delivered to the school / group, sorted for hand-out</b> <span className="faint">(free)</span></label>
        {s.delivery?.org?.on && <div className="grid g2" style={{ paddingLeft: 26 }}>
          <div className="field"><label>Where (shoppers see this)</label><input value={s.delivery.org.label} onChange={(e) => set("delivery", { ...s.delivery, org: { ...s.delivery.org, label: e.target.value } })} placeholder="Whitt Elementary" /></div>
          <div className="field"><label>Address (for our delivery)</label><input value={s.delivery.org.address} onChange={(e) => set("delivery", { ...s.delivery, org: { ...s.delivery.org, address: e.target.value } })} /></div>
        </div>}
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: "auto" }} disabled={locked} checked={!!s.delivery?.pickup?.on} onChange={(e) => set("delivery", { ...s.delivery, pickup: { ...s.delivery.pickup, on: e.target.checked } })} /><b>Pick up at FBS Print</b> <span className="faint">(free)</span></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: "auto" }} disabled={locked} checked={!!s.delivery?.ship?.on} onChange={(e) => set("delivery", { ...s.delivery, ship: { ...s.delivery.ship, on: e.target.checked } })} /><b>Ship to home</b> <span className="faint">flat rate</span>{s.delivery?.ship?.on && <input type="number" min={0} step={0.5} style={{ width: 90 }} value={s.delivery.ship.flat} onChange={(e) => set("delivery", { ...s.delivery, ship: { ...s.delivery.ship, flat: +e.target.value } })} />}</label>
      </div></div>

      <div className="grid g2">
        <div className="panel"><div className="panel-h"><b>Main contact</b><span className="faint">Gets the “ready to deliver” email</span></div><div className="panel-b grid" style={{ gap: 10 }}>
          <div className="field"><label>Name</label><input value={s.contact?.name || ""} onChange={(e) => set("contact", { ...s.contact, name: e.target.value })} /></div>
          <div className="field"><label>Email</label><input type="email" value={s.contact?.email || ""} onChange={(e) => set("contact", { ...s.contact, email: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input value={s.contact?.phone || ""} onChange={(e) => set("contact", { ...s.contact, phone: e.target.value })} /></div>
        </div></div>
        <div className="panel"><div className="panel-h"><b>Give-back</b></div><div className="panel-b grid" style={{ gap: 10 }}>
          <div className="faint" style={{ fontSize: 13 }}>Each product adds its give-back on top of FBS&apos;s price (set it per product). The report totals it when the store closes.</div>
          <div className="field"><label>Goal (optional)</label><input type="number" min={0} step={50} value={s.giveback?.goal || ""} onChange={(e) => set("giveback", { ...s.giveback, goal: +e.target.value || undefined })} placeholder="$1,000" /></div>
          {b.staff && <>
            <div className="grid g2">
              <div className="field"><label>Sales tax %</label><input type="number" step={0.01} value={s.tax_rate} onChange={(e) => set("tax_rate", +e.target.value)} /></div>
              <div className="field"><label>&nbsp;</label><label className="row" style={{ gap: 6 }}><input type="checkbox" style={{ width: "auto" }} checked={s.tax_exempt} onChange={(e) => set("tax_exempt", e.target.checked)} />No sales tax</label></div>
            </div>
            <div className="grid g2">
              <div className="field"><label>Expected pieces per design</label><input type="number" min={12} value={s.settings?.expected || 48} onChange={(e) => set("settings", { ...s.settings, expected: +e.target.value })} /><small className="faint">Sets FBS&apos;s suggested price.</small></div>
              <div className="field"><label>&nbsp;</label><label className="row" style={{ gap: 6 }}><input type="checkbox" style={{ width: "auto" }} checked={s.settings?.notify ?? true} onChange={(e) => set("settings", { ...s.settings, notify: e.target.checked })} />Email shoppers at each step</label></div>
            </div>
          </>}
        </div></div>
      </div>
      {b.staff && <div className="panel"><div className="panel-h"><b>Notes (staff only)</b></div><div className="panel-b"><textarea rows={3} value={s.notes} onChange={(e) => set("notes", e.target.value)} /></div></div>}

      <div className="ms-savebar" hidden={!dirty && !msg}>
        {msg && <span className={msg.ok ? "okmsg" : "pv-err"}>{msg.text}</span>}
        <span className="spacer" />
        {dirty && <button type="button" className="btn ghost" onClick={() => { setS(b.store); setMsg(null); }}>Undo</button>}
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save setup"}</button>
      </div>
    </div>
  );
}
