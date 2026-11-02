"use client";
import { useContext, useMemo, useState } from "react";
import { PageSearchContext, pageHit } from "@/components/ArtSearchContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CARRIERS, carrierOf, GOODS, shipGroups, trackedGoods, trackingUrl, trackWord, type GoodsItem, type GoodsStatus } from "@/lib/goods";
import type { PendingShipment } from "@/lib/manifest";
import { checkLink, readShipmentPaper, type SendGoods, type TrackingInput } from "@/app/portal/goods-actions";
import { portalAttachUrl } from "@/app/portal/message-actions";
import { createClient } from "@/lib/supabase/client";
import { fmtDateLong } from "@/lib/format";
import GoodsIssues from "@/components/GoodsIssues";

type R = { ok: boolean; error?: string };
/** goods they told us are coming that aren't on an order yet (customer_shipments) */
export type ToldShipment = { id: string; job_text: string; vendor: string; vendor_order: string; carrier: string; tracking: string; boxes: number | null; note: string; track_status: string | null; est_delivery: string | null; delivered_at: string | null; created_at: string };
const youTold = <span className="gdk-you">You told us</span>;
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)).replace(/, \d{4}$/, "") : "");
const pcsOf = (n: number) => `${n.toLocaleString()} pc${n === 1 ? "" : "s"}`;
const boxesOf = (n: number) => `${n} box${n === 1 ? "" : "es"}`;

/**
 * The portal's Goods tab for wholesale customers (Nov 2, Nick: "it just goes on and on… there's no real organization…
 * organized by orders… they can tell us about things that are coming… we should automatically pull in S&S and SanMar").
 * One card per order with how much of its goods are here, each supplier shipment as one line (tracking folded away),
 * the shipments we couldn't match at the top with "Which order?", and a form for goods coming from anywhere else.
 */
/** the order groups' header bars: an icon and one line each (Nov 2) */
const GROUP_ICON: Record<string, string> = {
  here: "M20 6 9 17l-5-5",
  way: "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
};
const GROUP_LINE: Record<string, string> = {
  here: "Your goods for these orders are checked in at FBS.",
  way: "On the way to us. We're tracking every box.",
  info: "We don't have tracking for these yet. Add it so we can watch for them.",
};

export default function PortalGoodsDesk({ items, incoming, told = [], canAct, canLink = canAct, qs, as, addTracking, linkIncoming, sendGoods, linkTold }: {
  items: GoodsItem[]; incoming: PendingShipment[]; told?: ToldShipment[]; canAct: boolean; /** staff in a customer's portal: can still put shipments on orders */ canLink?: boolean; qs: string; /** staff previewing: the customer */ as?: string;
  addTracking: (orderId: string, t: TrackingInput) => Promise<R>; linkIncoming: (pick: { lineId: string; orderId: string }[]) => Promise<R>;
  sendGoods?: (x: SendGoods) => Promise<R>; linkTold?: (ids: string[], orderId: string) => Promise<R>;
}) {
  const router = useRouter();
  const chatHref = (id: string) => `/portal${qs ? qs + "&" : "?"}area=messages&c=${id}:goods`;
  const [q0, setQ] = useState("");
  // the portal page's own search, at the right of its title (PageSearchContext); else this box's
  const outerQ = useContext(PageSearchContext);
  const q = outerQ ?? q0;
  const [addFor, setAddFor] = useState<string | null>(null);

  // each order's goods, worked out once: status by its tracking, boxes here of boxes coming
  const rows = useMemo(() => items.map((it) => {
    const st: GoodsStatus = trackedGoods(it.goods.status, it.shipments);
    const boxes = it.shipments.reduce((a, s) => a + (s.boxes || 1), 0);
    const here = it.shipments.filter((s) => s.track_status === "delivered" || s.delivered_at).reduce((a, s) => a + (s.boxes || 1), 0);
    const eta = it.shipments.filter((s) => !(s.track_status === "delivered" || s.delivered_at)).map((s) => s.est_delivery || s.eta).filter(Boolean).sort()[0] || null;
    // every box linked so far is here, but the suppliers' lists show fewer pieces than the order needs: more to come
    const short = it.pcs != null && it.order.qty > 0 && it.pcs < it.order.qty ? it.order.qty - it.pcs : 0;
    return { it, st, boxes, here, eta, short, done: st === "received" || (boxes > 0 && here >= boxes && !short) };
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

  // what they told us is coming without an order: one entry per time they sent it (its tracking numbers together)
  const toldGroups = useMemo(() => {
    const m = new Map<string, ToldShipment[]>();
    for (const t of told) { const k = `${t.created_at.slice(0, 19)}|${t.vendor}|${t.vendor_order}|${t.job_text}`; m.set(k, [...(m.get(k) || []), t]); }
    return [...m.entries()].map(([key, list]) => ({ key: "t:" + key, list }));
  }, [told]);
  const notLinked = incoming.length + toldGroups.length;
  // the numbers on top
  const onWay = [...rows.flatMap((r) => r.it.shipments.filter((s) => !(s.track_status === "delivered" || s.delivered_at))), ...incoming.flatMap((g) => g.tracking.filter((t) => !t.delivered)), ...told.filter((t) => !t.delivered_at)];
  const onWayBoxes = onWay.reduce((a, s) => a + ((s as { boxes?: number | null }).boxes || 1), 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const hereWeek = rows.flatMap((r) => r.it.shipments).filter((s) => s.delivered_at && s.delivered_at >= weekAgo).reduce((a, s) => a + (s.boxes || 1), 0);

  // a shipment dragged onto an order links it there (Nov 2, Nick: "drag it up to… the orders to make it go there")
  const [drag, setDrag] = useState<string | null>(null), [over, setOver] = useState<string | null>(null), [dropMsg, setDropMsg] = useState("");
  // a hand link is checked first (Nov 2, Nick: "hey, this doesn't match… hey, we show we received everything already…
  // just something to ask them if they're sure"): any doubt asks before it's linked
  const [sure, setSure] = useState<{ warnings: string[]; label: string; yes: () => void; no: () => void } | null>(null);
  const askSure = (warnings: string[], label: string) => new Promise<boolean>((done) => setSure({ warnings, label, yes: () => { setSure(null); done(true); }, no: () => { setSure(null); done(false); } }));
  const linkTo = async (g: PendingShipment, orderId: string): Promise<R> => {
    const ids = g.lines.flatMap((l) => l.id.split(",")).filter(Boolean);
    const c = await checkLink(ids, orderId).catch(() => null);
    const o = rows.find((r) => r.it.order.id === orderId)?.it.order;
    if (c?.ok && c.warnings.length && !(await askSure(c.warnings, `${g.supplier === "sanmar" ? "SanMar" : g.supplier === "ss" ? "S&S" : g.supplier} ${g.supplier_order} on #${o?.number || ""} ${o?.nickname || ""}`.trim()))) return { ok: false, error: "Not linked." };
    const r = await linkIncoming(ids.map((lineId) => ({ lineId, orderId }))); if (r.ok) router.refresh(); return r;
  };
  const linkToldTo = async (ids: string[], orderId: string): Promise<R> => { if (!linkTold) return { ok: false, error: "Couldn't link it." }; const r = await linkTold(ids, orderId); if (r.ok) router.refresh(); return r; };
  const dropOn = async (orderId: string) => {
    const key = drag; setDrag(null); setOver(null);
    const g = incoming.find((x) => x.key === key), t = toldGroups.find((x) => x.key === key);
    if (!g && !t) return;
    if (!canLink) { setDropMsg("This is a preview: customers link shipments from their own login."); return; }
    const r = g ? await linkTo(g, orderId) : await linkToldTo(t!.list.map((x) => x.id), orderId);
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
        <div className="gdk-c2">{groups.length ? groups.map((g, k) => <div key={k}><b>{g.supplier ? `${g.supplier.replace(/ Activewear$/, "")} ${g.order}` : "Your shipment"}</b>{!g.supplier && g.ships[0]?.added_by === "customer" ? <> {youTold}</> : null}{g.ships[0]?.note && g.supplier ? <span className="gdk-sm"> · {g.ships[0].note.split(" · ").slice(2).join(" · ") || ""}</span> : g.ships[0]?.note ? <span className="gdk-sm"> · {g.ships[0].note}</span> : null}</div>)
          : <span className="gdk-sm">No shipment yet{canAct ? <> · <button type="button" className="linkbtn" onClick={() => setAddFor(addFor === o.id ? null : o.id)}>Tell us what&apos;s coming</button></> : null}</span>}</div>
        <div className="gdk-c3">{r.boxes ? <span className={r.done ? "gdk-ok" : ""}>{r.done ? `All ${r.boxes} here` : r.here >= r.boxes ? `All ${r.boxes} linked here` : `${r.here} of ${r.boxes} here`}{r.short ? <span className="gdk-sm gdk-c3-sub">{pcsOf(r.short)} not shipped yet</span> : null}{!r.done && r.eta ? <span className="gdk-sm"> · {when(r.eta)}</span> : null}</span> : <span className="gdk-sm">—</span>}</div>
        <div className="gdk-c4">
          {trk.length > 0 ? <button type="button" className="gdk-trk" aria-expanded={trkOpen === o.id} onClick={() => setTrkOpen(trkOpen === o.id ? null : o.id)}>{trk.length} tracking {trkOpen === o.id ? "▴" : "▾"}</button> : <span className="gdk-sm">—</span>}
        </div>
        <div className="gdk-c5">
          <Link className="gdk-msg" href={chatHref(o.id)} title="Message us about these goods" aria-label="Message us about these goods"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></Link>
        </div>
        {trkOpen === o.id && (
          <ul className="gdk-trks gdk-full">
            {/* one tracking number can carry several boxes (S&S ships a master tracking for 8): say how many, so a box that's
                missing shows (Nov 2, Nick) */}
            {trk.map((x) => <li key={x.id} className={hereNow(x) ? "in" : "way"}><a href={trackingUrl(x.carrier, x.tracking)} target="_blank" rel="noreferrer">{x.carrier} {x.tracking}</a><span className="gdk-sm">{(x.boxes || 1) > 1 ? <b className="gdk-trk-n">{x.boxes} boxes · </b> : null}{hereNow(x) ? `Arrived ${when(x.delivered_at)}` : `${trackWord(x.track_status)}${x.est_delivery ? ` · ${when(x.est_delivery)}` : ""}`}</span></li>)}
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
      {/* problems with their goods first (Nov 2, Nick: "something at the top that says issues") */}
      <GoodsIssues as={as} />
      <div className="stats gdk-stats">
        <button type="button" className="stat" onClick={() => goTo("way")}><span className="k">On the way</span><span className="v">{boxesOf(onWayBoxes)}</span><small>{onWay.length ? "Tracked for you" : "Nothing in transit"}</small></button>
        <button type="button" className="stat" onClick={() => goTo("here")}><span className="k">Arrived this week</span><span className="v">{boxesOf(hereWeek)}</span><small>Checked in at FBS</small></button>
        <button type="button" className="stat" onClick={() => goTo("info")}><span className="k">Orders waiting on goods</span><span className="v">{waiting.length}</span><small>{waiting.filter((r) => r.here > 0).length ? `${waiting.filter((r) => r.here > 0).length} partly here` : "None partly here"}</small></button>
        <button type="button" className="stat" onClick={() => goTo("nl")}><span className="k">Shipments not linked</span><span className="v">{notLinked}</span><small>{notLinked ? "to put on an order" : "Everything's on an order"}</small></button>
      </div>

      <div className="aa-card gdk-list">
        <div className="toolbar gdk-bar">
          <b className="gdk-list-t">All orders</b>
          {outerQ === null &&           <label className="aa-search gdk-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" /></svg><input type="search" placeholder="Search order, PO or tracking" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search goods" /></label>}
          <button type="button" className="btn primary" onClick={() => setTell(true)}>+ Shipping us something?</button>
        </div>
        {drag && <div className="gdk-dragtip">Drop it on the order it&apos;s for.</div>}
        {dropMsg && <div className="gdk-dragtip bad">{dropMsg}</div>}
        {GROUPS.filter((g) => g.list.length).map((g) => (
          <section key={g.k} className={"gdk-grp g-" + g.k} aria-label={g.label}>
            {/* each group opens with the same header bar as Shipments not linked: its name, what it means, and a line in its
                color across, with the color bar down the side under it (Nov 2, Nick: "make this uniform") */}
            <div className="gdk-nlbar gdk-ghd">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={GROUP_ICON[g.k]} /></svg>
              <div><b>{g.label} · {g.list.length}</b><span>{GROUP_LINE[g.k]}</span></div>
            </div>
            <div className="gdk-vbar"><span>{g.label} · {g.list.length}</span></div>
            <div className="gdk-grp-b"><div className="gdk-row gdk-head" aria-hidden><span>Order</span><span>Shipment</span><span>Boxes</span><span>Tracking</span><span /></div>{g.list.map(card)}</div>
          </section>
        ))}
        {!shown.length && !notLinked && <div className="aa-empty">{w ? `Nothing matches “${q}”.` : "No orders with goods right now."}</div>}
      </div>
      {/* shipments not linked: their own box after a break, a header bar that says what to do, the violet bar down the
          side and a grip on each (Nov 2, Nick: "that line shouldn't fall in… a break there with some sort of bar") */}
      {sure && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Are you sure?" onClick={sure.no}>
          <div className="dla gdk-sure" onClick={(e) => e.stopPropagation()}>
            <h3>Are you sure?</h3>
            <p className="dla-sub" data-notranslate>{sure.label}</p>
            <ul>{sure.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>
            <div className="gdk-sg-acts"><button type="button" className="btn" onClick={sure.no}>Cancel</button><button type="button" className="btn primary" onClick={sure.yes}>Link it anyway</button></div>
          </div>
        </div>
      )}
      {tell && <SendGoodsDialog orders={rows.filter((r) => !r.done).map((r) => ({ id: r.it.order.id, label: `#${r.it.order.number} ${r.it.order.nickname}` }))} canAct={canAct}
        send={sendGoods} onClose={() => setTell(false)} onDone={() => { setTell(false); router.refresh(); }} />}
      {notLinked > 0 && (
        <div className="aa-card gdk-nlbox g-nl">
          <div className="gdk-nlbar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg>
            <div><b>Shipments not linked · {notLinked}</b><span>Your supplier shipped these to us, but we couldn&apos;t tell which order they&apos;re for. Drag one by its handle onto its order above, or pick the order here.</span></div>
          </div>
          <section className="gdk-grp g-nl gdk-help" aria-label="Shipments not linked">
            <div className="gdk-vbar"><span>Not linked</span></div>
            <div className="gdk-grp-b">
              {toldGroups.filter((t) => pageHit(q, ...t.list.flatMap((x) => [x.job_text, x.vendor, x.vendor_order, x.tracking, x.note]))).map((t) => <ToldRow key={t.key} list={t.list} canAct={canLink} orders={rows.filter((r) => !r.done).map((r) => ({ id: r.it.order.id, number: r.it.order.number, nickname: r.it.order.nickname }))}
                onDrag={(on) => { setDrag(on ? t.key : null); if (!on) setOver(null); setDropMsg(""); }} link={(orderId) => linkToldTo(t.list.map((x) => x.id), orderId)} />)}
              {incoming.filter((g) => pageHit(q, g.customer_po, g.supplier_order, g.supplier, g.styles, ...g.tracking.map((t) => t.tracking))).map((g) => <Unmatched key={g.key} g={g} canAct={canLink} onDrag={(on) => { setDrag(on ? g.key : null); if (!on) setOver(null); setDropMsg(""); }} link={(orderId) => linkTo(g, orderId)} />)}
            </div>
          </section>
        </div>
      )}
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
      <span className="gdk-grip" aria-hidden><svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.6" /><circle cx="10" cy="3" r="1.6" /><circle cx="4" cy="9" r="1.6" /><circle cx="10" cy="9" r="1.6" /><circle cx="4" cy="15" r="1.6" /><circle cx="10" cy="15" r="1.6" /></svg></span>
      <div className="gdk-um-t">
        <div><b>{g.supplier === "sanmar" ? "SanMar" : g.supplier === "ss" ? "S&S" : g.supplier} {g.supplier_order}</b>{g.customer_po ? <span className="gdk-sm"> · PO {g.customer_po}</span> : null} <span className={"gdk-st" + (here ? " in" : " way")}>{here ? "Arrived" : eta ? `On the way · ${when(eta)}` : "On the way"}</span></div>
        <div className="gdk-sm">{boxesOf(g.boxes)} · {pcsOf(g.pcs)}{g.styles ? ` · ${g.styles}` : ""}</div>
      </div>
      <div className="gdk-um-pick">
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

/** Goods they told us about with no order picked: waits at the top of "Shipments not linked" until it's put on one. */
function ToldRow({ list, orders, canAct, link, onDrag }: { list: ToldShipment[]; orders: { id: string; number: number; nickname: string }[]; canAct: boolean; link: (orderId: string) => Promise<R>; onDrag: (on: boolean) => void }) {
  const [pick, setPick] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const t0 = list[0], here = list.every((t) => t.delivered_at || t.track_status === "delivered");
  const eta = list.filter((t) => !t.delivered_at).map((t) => t.est_delivery).filter(Boolean).sort()[0];
  const nums = list.filter((t) => t.tracking);
  return (
    <div className="gdk-um gdk-told" draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", t0.id); e.dataTransfer.effectAllowed = "move"; onDrag(true); }} onDragEnd={() => onDrag(false)} title="Drag onto its order">
      <span className="gdk-grip" aria-hidden><svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.6" /><circle cx="10" cy="3" r="1.6" /><circle cx="4" cy="9" r="1.6" /><circle cx="10" cy="9" r="1.6" /><circle cx="4" cy="15" r="1.6" /><circle cx="10" cy="15" r="1.6" /></svg></span>
      <div className="gdk-um-t">
        <div><b data-notranslate>{[t0.vendor, t0.vendor_order].filter(Boolean).join(" ") || "Your shipment"}</b> {youTold} <span className={"gdk-st" + (here ? " in" : " way")}>{here ? "Arrived" : eta ? `On the way · ${when(eta)}` : "On the way"}</span></div>
        <div className="gdk-sm">{[t0.job_text && `For ${t0.job_text}`, t0.boxes ? boxesOf(t0.boxes) : nums.length > 1 ? `${nums.length} tracking` : "", t0.note].filter(Boolean).join(" · ") || `Sent ${when(t0.created_at)}`}</div>
      </div>
      <div className="gdk-um-pick">
        <select value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)} aria-label="Which order">
          <option value="">Pick an order…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>#{o.number} {o.nickname}</option>)}
        </select>
        <button type="button" className="btn primary" disabled={!canAct || !pick || busy} title={canAct ? undefined : "Turned off in preview"} onClick={async () => { setBusy(true); setErr(""); const r = await link(pick); setBusy(false); if (!r.ok) setErr(r.error || "Couldn't save."); }}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {err && <div className="gdk-err">{err}</div>}
    </div>
  );
}

/**
 * "Send us goods" (Nov 2, Nick): a pop-up. Drop their confirmation or packing slip at the top and we fill it in; then
 * where it's from, which job (pick one of their orders or type it: they often send goods before we know about the
 * order), what's in it, their order #, boxes and tracking. Everything optional.
 */
function SendGoodsDialog({ orders, canAct, send, onClose, onDone }: { orders: { id: string; label: string }[]; canAct: boolean; send?: (x: SendGoods) => Promise<R>; onClose: () => void; onDone: () => void }) {
  const [vendor, setVendor] = useState(""), [job, setJob] = useState(""), [what, setWhat] = useState(""), [vo, setVo] = useState(""), [boxes, setBoxes] = useState(""), [trk, setTrk] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [reading, setReading] = useState(""), [readNote, setReadNote] = useState(""), [over, setOver] = useState(false);
  const orderFor = (v: string) => { const w = v.trim().toLowerCase(); if (!w) return null; return orders.find((o) => o.label.toLowerCase() === w || o.label.toLowerCase().startsWith(w.replace(/^#?/, "#") + " ")) || null; };
  const picked = orderFor(job);
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
      if (x.vendor) setVendor(x.vendor);
      if (x.orderNo) setVo(x.orderNo);
      if (x.what) setWhat(x.what);
      if (x.boxes) setBoxes(String(x.boxes));
      if (x.tracking.length) setTrk(x.tracking.join("\n"));
      if (x.carrier) setCarrier(x.carrier);
      const o = orders.find((z) => z.id === x.orderId);
      if (o) setJob(o.label);
      setReadNote(`Filled in from ${input.file?.name || "what you pasted"}${o ? `, for ${o.label}${x.why ? ` (${x.why})` : ""}` : ""}. Check it, then press Send it.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't read it."); }
    setReading("");
  }
  async function go() {
    if (!send) return;
    setBusy(true); setMsg("");
    const r = await send({ orderId: picked?.id || "", job: picked ? "" : job, vendor, vendorOrder: vo, carrier, tracking: trk.split(/[\s,;]+/).filter(Boolean), boxes: boxes ? +boxes : null, what });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "Couldn't send it.");
    onDone();
  }
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Send us goods" onClick={() => !busy && onClose()}>
      <div className="dla gdk-sg" onClick={(e) => e.stopPropagation()}
        onPaste={(e) => { if ((e.target as HTMLElement).closest("input,textarea")) return; const f = e.clipboardData.files[0]; const t = e.clipboardData.getData("text"); if (f) { e.preventDefault(); void readIt({ file: f }); } else if (t.trim().length > 20) { e.preventDefault(); void readIt({ text: t }); } }}>
        <button type="button" className="dla-x" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        <h3>Send us goods</h3>
        <p className="dla-sub">Tell us what&apos;s coming so we can check it in and put it on your order. Everything is optional.</p>
        <label className={"gdk-drop" + (over ? " over" : "")} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { const f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); setOver(false); void readIt({ file: f }); }} tabIndex={0}>
          <b>{reading || "Drop the order confirmation or packing slip"}</b>
          {!reading && <span>A PDF, a picture, or paste the shipping email (Ctrl+V). We fill in the boxes below; you check them.</span>}
          <input type="file" hidden accept="application/pdf,.pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readIt({ file: f }); e.target.value = ""; }} />
        </label>
        {readNote && <div className="gdk-readnote">{readNote}</div>}
        <div className="gdk-sg-g">
          <label className="gdk-f"><span>Sending it from</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. One Stop, Peter Millar" /></label>
          <label className="gdk-f"><span>For which job</span><input list="gdk-sg-jobs" value={job} onChange={(e) => setJob(e.target.value)} placeholder="Pick an order or type the job" />
            <datalist id="gdk-sg-jobs">{orders.map((o) => <option key={o.id} value={o.label} />)}</datalist>
            <small>{picked ? `Goes on ${picked.label}` : job.trim() ? "No order yet: we'll put it on one when it's made" : ""}</small></label>
          <label className="gdk-f gdk-sg-wide"><span>What&apos;s in it</span><input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. 120 Comfort Colors 1717 tees, navy" /></label>
          <label className="gdk-f"><span>Their order or PO #</span><input value={vo} onChange={(e) => setVo(e.target.value)} placeholder="e.g. SO-88213" /></label>
          <label className="gdk-f"><span>Boxes</span><input inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 4" /></label>
          <label className="gdk-f gdk-sg-wide"><span>Tracking (one or more)</span><textarea rows={2} value={trk} onChange={(e) => setTrk(e.target.value)} placeholder="Paste tracking numbers; we spot UPS, FedEx and USPS" /></label>
        </div>
        {msg && <div className="gdk-err">{msg}</div>}
        <div className="gdk-sg-acts"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !canAct || !!reading} title={canAct ? undefined : "Turned off in preview"} onClick={go}>{busy ? "Sending…" : "Send it"}</button></div>
      </div>
    </div>
  );
}
