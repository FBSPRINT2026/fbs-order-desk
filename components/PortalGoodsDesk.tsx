"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CARRIERS, carrierOf, GOODS, shipGroups, trackedGoods, trackingUrl, trackWord, type GoodsItem, type GoodsStatus } from "@/lib/goods";
import type { PendingShipment } from "@/lib/manifest";
import { readShipmentPaper, type TrackingInput } from "@/app/portal/goods-actions";
import { portalAttachUrl } from "@/app/portal/message-actions";
import { createClient } from "@/lib/supabase/client";
import { fmtDateLong } from "@/lib/format";

type R = { ok: boolean; error?: string };
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)).replace(/, \d{4}$/, "") : "");
const pcsOf = (n: number) => `${n.toLocaleString()} pc${n === 1 ? "" : "s"}`;
const boxesOf = (n: number) => `${n} box${n === 1 ? "" : "es"}`;

/**
 * The portal's Goods tab for wholesale customers (Nov 2, Nick: "it just goes on and on… there's no real organization…
 * organized by orders… they can tell us about things that are coming… we should automatically pull in S&S and SanMar").
 * One card per order with how much of its goods are here, each supplier shipment as one line (tracking folded away),
 * the shipments we couldn't match at the top with "Which order?", and a form for goods coming from anywhere else.
 */
export default function PortalGoodsDesk({ items, incoming, canAct, qs, addTracking, linkIncoming }: {
  items: GoodsItem[]; incoming: PendingShipment[]; canAct: boolean; qs: string;
  addTracking: (orderId: string, t: TrackingInput) => Promise<R>; linkIncoming: (pick: { lineId: string; orderId: string }[]) => Promise<R>;
}) {
  const router = useRouter();
  const chatHref = (id: string) => `/portal${qs ? qs + "&" : "?"}area=messages&c=${id}:goods`;
  const [q, setQ] = useState("");
  const [addFor, setAddFor] = useState<string | null>(null);

  // each order's goods, worked out once: status by its tracking, boxes here of boxes coming
  const rows = useMemo(() => items.map((it) => {
    const st: GoodsStatus = trackedGoods(it.goods.status, it.shipments);
    const boxes = it.shipments.reduce((a, s) => a + (s.boxes || 1), 0);
    const here = it.shipments.filter((s) => s.track_status === "delivered" || s.delivered_at).reduce((a, s) => a + (s.boxes || 1), 0);
    const eta = it.shipments.filter((s) => !(s.track_status === "delivered" || s.delivered_at)).map((s) => s.est_delivery || s.eta).filter(Boolean).sort()[0] || null;
    return { it, st, boxes, here, eta, done: st === "received" || (boxes > 0 && here >= boxes) };
  }), [items]);
  const waiting = rows.filter((r) => !r.done), done = rows.filter((r) => r.done);
  const w = q.trim().toLowerCase().replace(/^#/, "");
  const hit = (r: (typeof rows)[number]) => !w || [String(r.it.order.number), r.it.order.nickname, r.it.goods.supplier_po || "", ...r.it.shipments.flatMap((s) => [s.tracking, s.note])].some((x) => String(x || "").toLowerCase().includes(w));
  // every order, grouped by where its goods are, each group with a colored bar down its left side (Nov 2, Nick: "all
  // orders by default… group them… a vertical color bar… here, in transit, waiting info… shipments not linked")
  const byDue = (a: (typeof rows)[number], b: (typeof rows)[number]) => (a.it.order.due_date || "9999").localeCompare(b.it.order.due_date || "9999");
  const shown = rows.filter(hit);
  const GROUPS = [
    { k: "here", label: "Here", list: shown.filter((r) => r.done).sort(byDue) },
    { k: "way", label: "In transit", list: shown.filter((r) => !r.done && r.boxes > 0).sort(byDue) },
    { k: "info", label: "Waiting info", list: shown.filter((r) => !r.done && !r.boxes).sort(byDue) },
  ];

  // the numbers on top
  const onWay = [...rows.flatMap((r) => r.it.shipments.filter((s) => !(s.track_status === "delivered" || s.delivered_at))), ...incoming.flatMap((g) => g.tracking.filter((t) => !t.delivered))];
  const onWayBoxes = onWay.reduce((a, s) => a + ((s as { boxes?: number | null }).boxes || 1), 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const hereWeek = rows.flatMap((r) => r.it.shipments).filter((s) => s.delivered_at && s.delivered_at >= weekAgo).reduce((a, s) => a + (s.boxes || 1), 0);

  // a shipment dragged onto an order links it there (Nov 2, Nick: "drag it up to… the orders to make it go there")
  const [drag, setDrag] = useState<string | null>(null), [over, setOver] = useState<string | null>(null), [dropMsg, setDropMsg] = useState("");
  const linkTo = async (g: PendingShipment, orderId: string) => { const ids = g.lines.flatMap((l) => l.id.split(",")).filter(Boolean); const r = await linkIncoming(ids.map((lineId) => ({ lineId, orderId }))); if (r.ok) router.refresh(); return r; };
  const dropOn = async (orderId: string) => {
    const g = incoming.find((x) => x.key === drag); setDrag(null); setOver(null);
    if (!g) return;
    if (!canAct) { setDropMsg("This is a preview: customers link shipments from their own login."); return; }
    const r = await linkTo(g, orderId);
    setDropMsg(r.ok ? "" : r.error || "Couldn't link it.");
  };
  const [tell, setTell] = useState(false);

  // one plain row per order (Nov 2, Nick: "it's a hard to read section"): the order, its shipments, boxes here, tracking
  const [trkOpen, setTrkOpen] = useState<string | null>(null);
  const card = (r: (typeof rows)[number]) => {
    const o = r.it.order, groups = shipGroups(r.it.shipments), trk = r.it.shipments.filter((s) => s.tracking);
    const hereNow = (s: { track_status?: string; delivered_at?: string | null }) => s.track_status === "delivered" || !!s.delivered_at;
    return (
      <article key={o.id} className={"gdk-row" + (drag ? " drop" : "") + (over === o.id ? " over" : "")}
        onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(o.id); } }} onDragLeave={() => setOver((x) => (x === o.id ? null : x))} onDrop={(e) => { e.preventDefault(); void dropOn(o.id); }}>
        <div className="gdk-c1"><Link className="gdk-on" href={o.href}>#{o.number}</Link> <b>{o.nickname || "Order"}</b>
          <div className="gdk-sm">{[o.due_date ? `In hands ${when(o.due_date)}` : "", o.qty ? pcsOf(o.qty) : ""].filter(Boolean).join(" · ")}</div></div>
        <div className="gdk-c2">{groups.length ? groups.map((g, k) => <div key={k}><b>{g.supplier ? `${g.supplier.replace(/ Activewear$/, "")} ${g.order}` : "Your shipment"}</b>{g.ships[0]?.note && g.supplier ? <span className="gdk-sm"> · {g.ships[0].note.split(" · ").slice(2).join(" · ") || ""}</span> : g.ships[0]?.note ? <span className="gdk-sm"> · {g.ships[0].note}</span> : null}</div>)
          : <span className="gdk-sm">No shipment yet{canAct ? <> · <button type="button" className="linkbtn" onClick={() => setAddFor(addFor === o.id ? null : o.id)}>Tell us what&apos;s coming</button></> : null}</span>}</div>
        <div className="gdk-c3">{r.boxes ? <span className={r.done ? "gdk-ok" : ""}>{r.done ? `All ${r.boxes} here` : `${r.here} of ${r.boxes} here`}{!r.done && r.eta ? <span className="gdk-sm"> · {when(r.eta)}</span> : null}</span> : <span className="gdk-sm">—</span>}</div>
        <div className="gdk-c4">
          {trk.length > 0 && <button type="button" className="gdk-trk" aria-expanded={trkOpen === o.id} onClick={() => setTrkOpen(trkOpen === o.id ? null : o.id)}>{trk.length} tracking {trkOpen === o.id ? "▴" : "▾"}</button>}
          <Link className="gdk-msg" href={chatHref(o.id)} title="Message us about these goods" aria-label="Message us about these goods"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></Link>
        </div>
        {trkOpen === o.id && (
          <ul className="gdk-trks gdk-full">
            {trk.map((x) => <li key={x.id}><a href={trackingUrl(x.carrier, x.tracking)} target="_blank" rel="noreferrer">{x.carrier} {x.tracking}</a><span className="gdk-sm">{hereNow(x) ? `Arrived ${when(x.delivered_at)}` : `${trackWord(x.track_status)}${x.est_delivery ? ` · ${when(x.est_delivery)}` : ""}`}</span></li>)}
            {canAct && <li><button type="button" className="linkbtn" onClick={() => setAddFor(addFor === o.id ? null : o.id)}>+ Tell us about another shipment</button></li>}
          </ul>
        )}
        {addFor === o.id && <div className="gdk-full"><TellUs orders={[{ id: o.id, label: `#${o.number} ${o.nickname}` }]} fixed add={addTracking} onDone={() => { setAddFor(null); router.refresh(); }} /></div>}
      </article>
    );
  };
  const goTo = (k: string) => document.querySelector(`.gdk-grp.g-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="gdk">
      <div className="stats gdk-stats">
        <button type="button" className="stat" onClick={() => goTo("way")}><span className="k">On the way</span><span className="v">{boxesOf(onWayBoxes)}</span><small>{onWay.length ? "Tracked for you" : "Nothing in transit"}</small></button>
        <button type="button" className="stat" onClick={() => goTo("here")}><span className="k">Arrived this week</span><span className="v">{boxesOf(hereWeek)}</span><small>Checked in at FBS</small></button>
        <button type="button" className="stat" onClick={() => goTo("info")}><span className="k">Orders waiting on goods</span><span className="v">{waiting.length}</span><small>{waiting.filter((r) => r.here > 0).length ? `${waiting.filter((r) => r.here > 0).length} partly here` : "None partly here"}</small></button>
        <button type="button" className="stat" onClick={() => goTo("nl")}><span className="k">Shipments not linked</span><span className="v">{incoming.length}</span><small>{incoming.length ? "to put on an order" : "Everything's on an order"}</small></button>
      </div>

      <div className="aa-card gdk-list">
        <div className="toolbar gdk-bar">
          <b className="gdk-list-t">All orders</b>
          <label className="aa-search gdk-search"><input type="search" placeholder="Search order, PO or tracking" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search goods" /></label>
          <button type="button" className={"btn" + (tell ? "" : " primary")} onClick={() => setTell(!tell)}>{tell ? "Close" : "+ Shipping us something?"}</button>
        </div>
        {tell && (
          <section className="gdk-tellcard">
            <div className="gdk-tell-h"><b>Shipping us something?</b><span>From anywhere other than S&amp;S or SanMar (those show up here by themselves): drop the confirmation and we&apos;ll watch for it.</span></div>
            {canAct && rows.length ? <TellUs orders={(waiting.length ? waiting : rows).map((r) => ({ id: r.it.order.id, label: `#${r.it.order.number} ${r.it.order.nickname}` }))} add={addTracking} onDone={() => { setTell(false); router.refresh(); }} />
              : <div className="gdk-sm">{canAct ? "No open orders to send goods for." : "Customers add shipments from their own login."}</div>}
          </section>
        )}
        <div className="gdk-legend" aria-hidden><span><i className="g-here" />Here</span><span><i className="g-way" />In transit</span><span><i className="g-info" />Waiting info</span><span><i className="g-nl" />Shipments not linked</span></div>
        {drag && <div className="gdk-dragtip">Drop it on the order it&apos;s for.</div>}
        {dropMsg && <div className="gdk-dragtip bad">{dropMsg}</div>}
        {GROUPS.filter((g) => g.list.length).map((g) => (
          <section key={g.k} className={"gdk-grp g-" + g.k} aria-label={g.label}>
            <div className="gdk-vbar"><span>{g.label} · {g.list.length}</span></div>
            <div className="gdk-grp-b"><div className="gdk-row gdk-head" aria-hidden><span>Order</span><span>Shipment</span><span>Boxes</span><span /></div>{g.list.map(card)}</div>
          </section>
        ))}
        {incoming.length > 0 && (
          <section className="gdk-grp g-nl gdk-help" aria-label="Shipments not linked">
            <div className="gdk-vbar"><span>Shipments not linked · {incoming.length}</span></div>
            <div className="gdk-grp-b">
              <div className="gdk-nl-h">Your supplier shipped these to us, but we couldn&apos;t tell which order they&apos;re for. Drag one onto its order above, or pick it here.</div>
              {incoming.map((g) => <Unmatched key={g.key} g={g} canAct={canAct} onDrag={(on) => { setDrag(on ? g.key : null); if (!on) setOver(null); setDropMsg(""); }} link={(orderId) => linkTo(g, orderId)} />)}
            </div>
          </section>
        )}
        {!shown.length && !incoming.length && <div className="aa-empty">{w ? `Nothing matches “${q}”.` : "No orders with goods right now."}</div>}
      </div>
    </div>
  );
}

/** One supplier shipment on an order: who, what, how many boxes are here; its tracking folded away. */
function ShipLine({ g }: { g: ReturnType<typeof shipGroups>[number] }) {
  const [open, setOpen] = useState(false);
  const total = g.ships.reduce((a, s) => a + (s.boxes || 1), 0);
  const here = g.ships.filter((s) => s.track_status === "delivered" || s.delivered_at).reduce((a, s) => a + (s.boxes || 1), 0);
  const eta = g.ships.filter((s) => !(s.track_status === "delivered" || s.delivered_at)).map((s) => s.est_delivery || s.eta).filter(Boolean).sort()[0];
  const what = g.ships[0]?.note && g.supplier ? g.ships[0].note.split(" · ").slice(2).join(" · ") : g.ships[0]?.note || "";
  const trk = g.ships.filter((s) => s.tracking);
  return (
    <div className="gdk-sh">
      <div className="gdk-sh-row">
        <div className="gdk-sh-who"><b>{g.supplier ? `${g.supplier} ${g.order}` : "Your shipment"}</b>{(g.pcs || what) && <span className="gdk-sm"> · {[g.pcs ? pcsOf(g.pcs) : "", what].filter(Boolean).join(" · ")}</span>}</div>
        <span className={"gdk-st" + (here >= total ? " in" : here ? " part" : " way")}>{here >= total ? (total > 1 ? `All ${total} boxes here` : "Arrived") : here ? `${here} of ${total} boxes here` : eta ? `On the way · ${when(eta)}` : "On the way"}</span>
        {trk.length > 0 && <button type="button" className="gdk-trk" aria-expanded={open} onClick={() => setOpen(!open)}>{trk.length} tracking {open ? "▴" : "▾"}</button>}
      </div>
      {open && (
        <ul className="gdk-trks">
          {trk.map((s) => (
            <li key={s.id}><a href={trackingUrl(s.carrier, s.tracking)} target="_blank" rel="noreferrer">{s.carrier} {s.tracking}</a><span className="gdk-sm">{s.track_status === "delivered" || s.delivered_at ? `Arrived ${when(s.delivered_at)}` : `${trackWord(s.track_status)}${s.est_delivery ? ` · ${when(s.est_delivery)}` : ""}`}{s.track_detail ? ` · ${s.track_detail}` : ""}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A supplier shipment we couldn't match: one line and a "Pick an order" box. */
function Unmatched({ g, canAct, link, onDrag }: { g: PendingShipment; canAct: boolean; link: (orderId: string) => Promise<R>; onDrag: (on: boolean) => void }) {
  const [pick, setPick] = useState(g.lines.find((l) => l.suggest)?.suggest || "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const here = g.tracking.length > 0 && g.tracking.every((t) => t.delivered);
  const eta = g.tracking.filter((t) => !t.delivered).map((t) => t.eta).filter(Boolean).sort()[0];
  return (
    <div className="gdk-um" draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", g.key); e.dataTransfer.effectAllowed = "move"; onDrag(true); }} onDragEnd={() => onDrag(false)} title="Drag onto its order">
      <div className="gdk-um-t">
        <div><b>{g.supplier === "sanmar" ? "SanMar" : g.supplier === "ss" ? "S&S" : g.supplier} {g.supplier_order}</b>{g.customer_po ? <span className="gdk-sm"> · PO {g.customer_po}</span> : null} <span className={"gdk-st" + (here ? " in" : " way")}>{here ? "Arrived" : eta ? `On the way · ${when(eta)}` : "On the way"}</span></div>
        <div className="gdk-sm">{boxesOf(g.boxes)} · {pcsOf(g.pcs)}{g.styles ? ` · ${g.styles}` : ""}</div>
      </div>
      <div className="gdk-um-pick">
        <span className="gdk-grip" aria-hidden>⋮⋮</span>
        <select value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)} aria-label="Which order">
          <option value="">Pick an order…</option>
          {g.orders.map((o) => <option key={o.id} value={o.id}>#{o.number} {o.nickname}{o.po ? ` · PO ${o.po}` : ""}</option>)}
        </select>
        <button type="button" className="btn primary" disabled={!canAct || !pick || busy} title={canAct ? undefined : "Turned off in preview"} onClick={async () => { setBusy(true); setErr(""); const r = await link(pick); setBusy(false); if (!r.ok) setErr(r.error || "Couldn't save."); }}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {err && <div className="gdk-err">{err}</div>}
    </div>
  );
}

/** "Tell us it's coming": the order, the carrier, one or many tracking numbers, how many boxes and what's in them. */
function TellUs({ orders, fixed, add, onDone }: { orders: { id: string; label: string }[]; fixed?: boolean; add: (orderId: string, t: TrackingInput) => Promise<R>; onDone: () => void }) {
  const [orderId, setOrderId] = useState(orders[0]?.id || "");
  const [carrier, setCarrier] = useState("UPS");
  const [trk, setTrk] = useState(""), [boxes, setBoxes] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  // their paperwork read into the form (Nov 2, Nick: "drag and drop… a One Stop order or Peter Millar order… read it")
  const [reading, setReading] = useState(""), [readNote, setReadNote] = useState(""), [over, setOver] = useState(false);
  async function readIt(input: { file?: File; text?: string }) {
    setMsg(""); setReadNote(""); setReading(input.file ? `Reading ${input.file.name}…` : "Reading it…");
    try {
      let up: { path?: string; name?: string; type?: string } = {};
      if (input.file) {
        const t = await portalAttachUrl(input.file.name);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Couldn't take that file.");
        const u = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, input.file, { contentType: input.file.type || undefined });
        if (u.error) throw new Error(u.error.message);
        up = { path: t.path, name: input.file.name, type: input.file.type };
      }
      const r = await readShipmentPaper({ ...up, text: input.text, orders });
      if (!r.ok || !r.read) throw new Error(r.error || "Couldn't read it.");
      const x = r.read;
      if (x.orderId && !fixed) setOrderId(x.orderId);
      if (x.carrier) setCarrier(CARRIERS.find((c) => c.toLowerCase() === x.carrier.toLowerCase()) || (carrierOf(x.tracking[0] || "") || "Other"));
      if (x.tracking.length) setTrk(x.tracking.join("\n"));
      if (x.boxes) setBoxes(String(x.boxes));
      setNote([[x.vendor, x.orderNo].filter(Boolean).join(" "), x.what, x.eta ? `arrives ${x.eta}` : ""].filter(Boolean).join(" · ").slice(0, 300));
      const o = orders.find((z) => z.id === (x.orderId || orderId));
      setReadNote(`Read it${x.vendor ? `: ${x.vendor}${x.orderNo ? ` ${x.orderNo}` : ""}` : ""}${x.orderId && o ? `, for ${o.label}${x.why ? ` (${x.why})` : ""}` : ""}. Check it, then press Tell us it's coming.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't read it."); }
    setReading("");
  }
  async function send() {
    const nums = trk.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!orderId) return setMsg("Pick the order.");
    if (!nums.length && !note.trim()) return setMsg("Add a tracking number, or tell us what's coming.");
    setBusy(true); setMsg("");
    const b = boxes ? Math.max(1, Math.round(+boxes)) : null;
    for (const t of nums.length ? nums : [""]) {
      const r = await add(orderId, { carrier: carrierOf(t) || carrier, tracking: t, boxes: nums.length > 1 ? null : b, eta: null, note: note.trim(), files: [] });
      if (!r.ok) { setBusy(false); return setMsg(r.error || "Couldn't save."); }
    }
    setBusy(false); setTrk(""); setBoxes(""); setNote(""); setMsg("Thanks, we'll watch for it.");
    onDone();
  }
  return (
    <div className="gdk-tell">
      <label className={"gdk-drop" + (over ? " over" : "")} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { const f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); e.stopPropagation(); setOver(false); void readIt({ file: f }); }}
        onPaste={(e) => { const f = e.clipboardData.files[0]; const t = e.clipboardData.getData("text"); if (f) { e.preventDefault(); void readIt({ file: f }); } else if (t.trim().length > 20) { e.preventDefault(); void readIt({ text: t }); } }} tabIndex={0}>
        <b>{reading || "Drop the order confirmation or shipping email"}</b>
        {!reading && <span>A PDF or a picture, or paste the email here. We read it and fill this in.</span>}
        <input type="file" hidden accept="application/pdf,.pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readIt({ file: f }); e.target.value = ""; }} />
      </label>
      {readNote && <div className="gdk-readnote">{readNote}</div>}
      {!fixed && <label className="gdk-f"><span>For order</span><select value={orderId} onChange={(e) => setOrderId(e.target.value)}>{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
      <label className="gdk-f"><span>Carrier</span><select value={carrier} onChange={(e) => setCarrier(e.target.value)}>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="gdk-f"><span>Tracking numbers</span><textarea rows={2} placeholder="Paste one or many" value={trk} onChange={(e) => setTrk(e.target.value)} /></label>
      <div className="gdk-two">
        <label className="gdk-f"><span>Boxes</span><input inputMode="numeric" placeholder="4" value={boxes} onChange={(e) => setBoxes(e.target.value.replace(/[^\d]/g, ""))} /></label>
        <label className="gdk-f"><span>What&apos;s in it</span><input placeholder="e.g. 300 Bella 3001 Black" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <button type="button" className="btn primary gdk-go" disabled={busy} onClick={send}>{busy ? "Saving…" : "Tell us it's coming"}</button>
      {msg && <div className="gdk-sm">{msg}</div>}
    </div>
  );
}
