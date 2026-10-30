"use client";
import { useState } from "react";
import { bySizeOrder } from "@/lib/sizeOrder";
import Link from "next/link";
import { carrierOf, CARRIERS, GOODS, GOODS_ORDER, goodsNeedInfo, ISSUES, shipFrom, shipGroups, supplierLabel, TRACK, trackWord, trackingUrl, type GoodsItem, type GoodsStatus, type IssueType } from "@/lib/goods";
import GoodsInfoFields, { cleanGoodsInfo, type GoodsInfoValue } from "@/components/GoodsInfoFields";
import type { Attachment } from "@/lib/messages";
import { fmtDateLong } from "@/lib/format";

export type GoodsActions = {
  addTracking: (orderId: string, t: { carrier: string; tracking: string; boxes: number | null; eta: string | null; note: string; files: Attachment[] }) => Promise<{ ok: boolean; error?: string }>;
  message: (orderId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  /** portal only: attach a packing slip or photo */
  upload?: (f: File) => Promise<Attachment>;
  /** where the goods come from (supplier, supplier order #, ship date) */
  saveInfo?: (orderId: string, v: GoodsInfoValue) => Promise<{ ok: boolean; error?: string }>;
  /** shop only */
  setStatus?: (orderId: string, s: GoodsStatus, issue: IssueType, note: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>;
  /** after any change: reload the list */
  changed: () => void;
  /** where the full goods conversation lives */
  chatHref: (orderId: string) => string;
  /** open the goods conversation in a Messages hub on the same page, if there is one */
  openChat?: (orderId: string) => void;
};

const STEPS: { k: GoodsStatus[]; label: string }[] = [
  { k: ["waiting"], label: "Waiting" }, { k: ["on_way"], label: "On the way" }, { k: ["arrived", "partial", "issue"], label: "Checking in" }, { k: ["received"], label: "Received" },
];
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)) : "");
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

/**
 * Customer supplied goods (wholesale): one card per job with the goods status, a step tracker,
 * shipments with tracking links, and quick actions: add tracking, message about the goods, and (shop) set the status.
 */
export default function GoodsBoard({ mode, items, act, canAct = true, compact = false, dense = false, empty }: { mode: "portal" | "shop"; items: GoodsItem[]; act: GoodsActions; canAct?: boolean; compact?: boolean; /** one short row per job (the portal Goods tab: Oct 24, Nick: "these boxes are huge… 30 orders… scroll forever") */ dense?: boolean; empty?: string }) {
  if (!items.length) return <div className="gb-empty">{empty || (mode === "portal" ? "No jobs are waiting on your goods right now." : "No customer supplied goods on open jobs.")}</div>;
  return <div className={"gb" + (compact ? " compact" : "") + (dense ? " dense" : "")}>{items.map((it) => <GoodsCard key={it.order.id} it={it} mode={mode} act={act} canAct={canAct} compact={compact || dense} />)}</div>;
}

function GoodsCard({ it, mode, act, canAct, compact }: { it: GoodsItem; mode: "portal" | "shop"; act: GoodsActions; canAct: boolean; compact: boolean }) {
  const g = GOODS[it.goods.status];
  const [panel, setPanel] = useState<"" | "track" | "msg" | "status" | "info" | "count">("");
  const needInfo = goodsNeedInfo(it.goods, it.shipments);
  const [info, setInfo] = useState<GoodsInfoValue>({ supplier: it.goods.supplier || "", supplier_po: it.goods.supplier_po || "", ship_date: it.goods.ship_date || null });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const stepAt = STEPS.findIndex((s) => s.k.includes(it.goods.status));
  // where the goods come from: the suppliers on the manifest shipments when there are any (each with its own order, Oct
  // 30, #40284 said "Coming from SanMar · order 77288309", S&S's order), else what was typed in
  const groups = shipGroups(it.shipments), fromShips = groups.map((x) => x.supplier).filter(Boolean);
  const named = fromShips.length ? [...new Set([supplierLabel(it.goods.supplier), ...fromShips].filter(Boolean))] : [];
  const run = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => { setBusy(true); setNote(""); const r = await p; setBusy(false); if (!r.ok) setNote(r.error || "Couldn't save."); else { setNote(done); setPanel(""); act.changed(); } };
  return (
    <article className={"gc" + (it.goods.status === "issue" ? " issue" : "")} style={{ ["--gc" as string]: g.c }}>
      <header className="gc-h">
        <div className="gc-t">
          <Link href={it.order.href} className="gc-no">#{it.order.number}</Link>
          <b>{it.order.nickname || "Order"}</b>
          <span className="gc-sub">{it.order.statusLabel}{it.order.due_date ? ` · in hands ${when(it.order.due_date)}` : ""}{it.order.qty ? ` · ${it.order.qty} pcs` : ""}</span>
        </div>
        <span className="gc-st">{needInfo ? (mode === "portal" ? "Tell us where your goods are coming from" : "Waiting on info") : mode === "portal" ? g.portal : it.goods.by === "Printavo" && (it.goods.status === "received" || it.goods.status === "partial") ? (it.goods.status === "received" ? "Received in Printavo" : "Partly received in Printavo") : g.label}</span>
      </header>

      <ol className="gc-steps" aria-label="Goods progress">
        {STEPS.map((s, i) => <li key={s.label} className={(i < stepAt ? "done" : i === stepAt ? "now" : "") + (i === stepAt && it.goods.status === "issue" ? " bad" : "")}><span />{s.label}</li>)}
      </ol>

      {it.goods.status === "issue"
        ? <div className="gc-issue"><b>{ISSUES[(it.goods.issue_type || "other") as Exclude<IssueType, "">]}</b>{it.goods.issue_note && <p>{it.goods.issue_note}</p>}<span>{mode === "portal" ? "Tap Message about goods so we can sort it out." : "The customer was told in their goods conversation."}</span></div>
        : !compact && <p className="gc-help">{mode === "portal" ? g.help : ""}</p>}

      <div className={"gc-from" + (needInfo ? " need" : "")}>
        {named.length
          ? <span>Coming from {named.map((n, i) => <span key={n}>{i ? (i === named.length - 1 ? " and " : ", ") : ""}<b>{n}</b></span>)}{it.goods.ship_date ? <> · ships {when(it.goods.ship_date)}</> : null}</span>
          : it.goods.supplier
          ? <span>Coming from <b>{supplierLabel(it.goods.supplier)}</b>{it.goods.supplier_po ? <> · order/PO {it.goods.supplier_po}</> : null}{it.goods.ship_date ? <> · ships {when(it.goods.ship_date)}</> : null}</span>
          : <span>{mode === "portal" ? "Where are these goods coming from? SanMar, S&S Activewear…" : "Supplier not known yet."}</span>}
        {act.saveInfo && <button type="button" className="linkbtn" disabled={!canAct} onClick={() => setPanel(panel === "info" ? "" : "info")}>{it.goods.supplier ? "Change" : "Add"}</button>}
      </div>
      {panel === "info" && act.saveInfo && (
        <div className="gc-form">
          <GoodsInfoFields v={info} onChange={setInfo} disabled={busy} />
          <div className="row"><button type="button" className="btn primary sm" disabled={busy} onClick={() => run(act.saveInfo!(it.order.id, cleanGoodsInfo(info)), "Saved.")}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn sm ghost" onClick={() => setPanel("")}>Cancel</button></div>
        </div>
      )}

      {/* one line a package, grouped by supplier order (Oct 30, Nick: "this goods area is going to get really long…
          put the tracking number, then… delivered and what was in it… two lines max"); the latest scan on hover */}
      {groups.length > 0 && (
        <div className="gc-sgs">
          {groups.map((gr) => {
            const del = gr.ships.filter((s) => s.track_status === "delivered"), all = del.length > 0 && del.length === gr.ships.length;
            const last = del.map((s) => s.delivered_at || "").filter(Boolean).sort().pop();
            const eta = gr.ships.map((s) => s.est_delivery || s.eta || "").filter(Boolean).sort().pop();
            const sum = all ? `Delivered${last ? ` ${when(last)}` : ""}` : del.length ? `${del.length} of ${gr.ships.length} delivered` : eta ? `Arrives ${when(eta)}` : "";
            return (
              <section className="gc-sg" key={gr.supplier + "|" + gr.order}>
                <div className="gc-sg-h">
                  <b>{gr.supplier || "Tracking"}</b>{gr.order ? <span> · order <span className="nw">{gr.order}</span></span> : null}
                  <span className="faint"> · {[gr.pcs ? `${gr.pcs} pcs` : "", `${gr.ships.length} package${gr.ships.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                  {sum && <span className={"gc-sg-st" + (all ? " ok" : "")}>{sum}</span>}
                </div>
                <ul className="gc-ships">
                  {gr.ships.map((s) => {
                    const f = shipFrom(s), by = s.added_by === "staff" ? (mode === "shop" ? "shop" : "us") : s.author_name || "customer";
                    return (
                      <li key={s.id}>
                        <span className="gc-ln">
                          {s.tracking ? <a href={trackingUrl(s.carrier, s.tracking)} target="_blank" rel="noreferrer" className="nw"><b>{s.carrier || carrierOf(s.tracking) || "Tracking"}</b> {s.tracking}</a> : <b>{f ? s.carrier || "Local truck" : "Shipment note"}</b>}
                          {s.track_status && <span className={"gc-track t-" + s.track_status} title={[TRACK[s.track_status] || "", s.track_detail || ""].filter(Boolean).join(" · ")}><b>{trackWord(s.track_status)}</b>{s.track_status === "delivered" ? (s.delivered_at ? ` ${when(s.delivered_at)}` : "") : s.est_delivery ? ` · arrives ${when(s.est_delivery)}` : ""}</span>}
                          {!s.track_status && s.eta && <span className="faint">expected {when(s.eta)}</span>}
                          {f ? <span className="faint">{[f.pcs ? `${f.pcs} pcs` : "", f.what, s.boxes && s.boxes > 1 ? `${s.boxes} boxes` : ""].filter(Boolean).join(" · ")}</span>
                            : <span className="faint">{[s.boxes ? `${s.boxes} box${s.boxes === 1 ? "" : "es"}` : "", `added ${ago(s.created_at)} by ${by}`].filter(Boolean).join(" · ")}</span>}
                        </span>
                        {!f && s.note && <p>{s.note}</p>}
                        {s.files.length > 0 && <div className="gc-files">{s.files.map((x, k) => <a key={k} href={x.url || undefined} target="_blank" rel="noreferrer">{/^image\//.test(x.mime) && x.url ? <img src={x.url} alt={x.name} /> : <span>📄 {x.name}</span>}</a>)}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {it.last && (
        <button type="button" className={"gc-last" + (it.unread ? " unread-msg" : "")} onClick={() => (act.openChat ? act.openChat(it.order.id) : (location.href = act.chatHref(it.order.id)))}>
          <span>{it.unread ? <i>{it.unread} new</i> : null}<b>{it.last.mine ? "You" : it.last.who}:</b> {it.last.body.slice(0, 140)}</span><small>{ago(it.last.at)}</small>
        </button>
      )}

      <div className="gc-acts">
        {/* the order's little Goods panel has no Count in (Oct 29, Nick): goods are counted in on Receiving */}
        {mode === "shop" && !compact && act.setStatus && !!it.lines?.length && it.goods.status !== "received" && <button type="button" className={"btn sm" + (panel === "count" ? " primary" : ["arrived", "partial"].includes(it.goods.status) ? " primary" : "")} disabled={!canAct} onClick={() => setPanel(panel === "count" ? "" : "count")}>Count in</button>}
        {(mode === "shop" || it.goods.status !== "received") && <button type="button" className={"btn sm" + (panel === "track" ? " primary" : mode === "portal" && it.goods.status === "waiting" ? " primary" : "")} disabled={!canAct} onClick={() => setPanel(panel === "track" ? "" : "track")}>+ Add tracking</button>}
        {mode === "shop" && <button type="button" className={"btn sm" + (panel === "status" ? " primary" : "")} disabled={!canAct} onClick={() => setPanel(panel === "status" ? "" : "status")}>Update status</button>}
        <button type="button" className={"btn sm" + (panel === "msg" ? " primary" : "")} disabled={!canAct} onClick={() => setPanel(panel === "msg" ? "" : "msg")}>Message about goods</button>
        <span className="spacer" />
        <Link className="gc-link" href={act.chatHref(it.order.id)}>Conversation</Link>
        <Link className="gc-link" href={it.order.href}>View order</Link>
      </div>

      {panel === "track" && <TrackForm mode={mode} busy={busy} upload={act.upload} onSave={(t) => run(act.addTracking(it.order.id, t), "Tracking saved.")} onCancel={() => setPanel("")} />}
      {panel === "msg" && (
        <div className="gc-form">
          <textarea rows={3} autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={mode === "portal" ? "e.g. Two more boxes ship Monday, the 2XLs are backordered…" : "e.g. We counted 46 of 48 mediums. Are two more coming?"} aria-label="Message about the goods" />
          <div className="row"><button type="button" className="btn primary sm" disabled={busy || !msg.trim()} onClick={() => run(act.message(it.order.id, msg).then((r) => { if (r.ok) setMsg(""); return r; }), "Sent.")}>{busy ? "Sending…" : "Send"}</button><button type="button" className="btn sm ghost" onClick={() => setPanel("")}>Cancel</button></div>
        </div>
      )}
      {panel === "count" && act.setStatus && it.lines && <CountForm it={it} busy={busy} onSave={(st, i, n) => run(act.setStatus!(it.order.id, st, i, n), st === "received" ? "Counted in. The customer was told everything checked out." : "Saved. The customer was told about the difference.")} onCancel={() => setPanel("")} />}
      {panel === "status" && act.setStatus && <StatusForm it={it} busy={busy} onSave={(s, i, n) => run(act.setStatus!(it.order.id, s, i, n), s === "issue" || s === "received" ? "Saved. The customer was emailed." : "Saved.")} onCancel={() => setPanel("")} />}
      {note && <div className="gc-note">{note}</div>}
    </article>
  );
}

function TrackForm({ mode, busy, upload, onSave, onCancel }: { mode: "portal" | "shop"; busy: boolean; upload?: (f: File) => Promise<Attachment>; onSave: (t: { carrier: string; tracking: string; boxes: number | null; eta: string | null; note: string; files: Attachment[] }) => void; onCancel: () => void }) {
  const [tracking, setTracking] = useState(""), [carrier, setCarrier] = useState(""), [boxes, setBoxes] = useState(""), [eta, setEta] = useState(""), [note, setNote] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]), [up, setUp] = useState(false), [err, setErr] = useState("");
  const guess = carrierOf(tracking);
  return (
    <div className="gc-form">
      <div className="gc-grid">
        <label className="wide">Tracking number<input type="text" autoFocus value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1Z… / 7712… / 9400…" />{guess && !carrier && <small>Looks like {guess}</small>}</label>
        <label>Carrier<select value={carrier} onChange={(e) => setCarrier(e.target.value)}><option value="">{guess ? `${guess} (detected)` : "Choose…"}</option>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Boxes<input type="number" min={1} value={boxes} onChange={(e) => setBoxes(e.target.value)} placeholder="#" /></label>
        <label>Expected<input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></label>
        <label className="wide">What&apos;s coming (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 48 Gildan 5000 Navy from S&S, 2XLs in a separate box" /></label>
      </div>
      {mode === "portal" && upload && (
        <div className="gc-up">
          <label className="btn sm">{up ? "Uploading…" : "Attach packing slip or photo"}<input type="file" hidden multiple accept="image/*,application/pdf" onChange={async (e) => {
            const list = Array.from(e.target.files || []); e.target.value = ""; if (!list.length) return;
            setUp(true); setErr("");
            for (const f of list) { try { const a = await upload(f); setFiles((x) => [...x, a]); } catch (er) { setErr(er instanceof Error ? er.message : "Upload failed"); } }
            setUp(false);
          }} /></label>
          {files.map((f, i) => <span key={i} className="mh-pf">{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}>✕</button></span>)}
          {err && <span className="bad">{err}</span>}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy || up || (!tracking.trim() && !note.trim() && !files.length)} onClick={() => onSave({ carrier: carrier || guess, tracking: tracking.trim(), boxes: boxes ? +boxes : null, eta: eta || null, note, files })}>{busy ? "Saving…" : "Save tracking"}</button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function StatusForm({ it, busy, onSave, onCancel }: { it: GoodsItem; busy: boolean; onSave: (s: GoodsStatus, i: IssueType, n: string) => void; onCancel: () => void }) {
  const [s, setS] = useState<GoodsStatus>(it.goods.status), [i, setI] = useState<IssueType>(it.goods.issue_type || "short"), [n, setN] = useState(it.goods.issue_note || "");
  return (
    <div className="gc-form">
      <div className="gc-stbtns">{GOODS_ORDER.map((k) => <button key={k} type="button" className={s === k ? "on" : ""} style={{ ["--gc" as string]: GOODS[k].c }} onClick={() => setS(k)}>{GOODS[k].label}</button>)}</div>
      {(s === "issue" || s === "partial") && (
        <div className="gc-grid">
          {s === "issue" && <label className="wide">Issue<select value={i} onChange={(e) => setI(e.target.value as IssueType)}>{(Object.keys(ISSUES) as Exclude<IssueType, "">[]).map((k) => <option key={k} value={k}>{ISSUES[k]}</option>)}</select></label>}
          <label className="wide">Note for the customer<textarea rows={3} value={n} onChange={(e) => setN(e.target.value)} placeholder="e.g. Received 46 of 48 M Navy. Box 2 was the wrong color (Royal instead of Navy)." /></label>
        </div>
      )}
      <div className="faint" style={{ fontSize: 12 }}>{["arrived", "partial", "received", "issue"].includes(s) ? "This posts in their goods conversation" + (s === "issue" || s === "received" ? " and emails them." : ".") : "Only changes the status."}</div>
      <div className="row"><button type="button" className="btn primary sm" disabled={busy} onClick={() => onSave(s, s === "issue" ? i : "", n)}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/**
 * Counting goods in against the order: expected quantity next to a count box for every size. All matching →
 * Received. Anything different → an issue (short / over) with the differences written out for the customer.
 */
function CountForm({ it, busy, onSave, onCancel }: { it: GoodsItem; busy: boolean; onSave: (s: GoodsStatus, i: IssueType, n: string) => void; onCancel: () => void }) {
  const lines = it.lines || [];
  const [n, setN] = useState<Record<string, string>>({});
  const key = (li: number, z: string) => `${li}|${z}`;
  const diffs = lines.flatMap((l, li) => Object.entries(l.sizes).sort(([a], [b]) => bySizeOrder(a, b)).map(([z, want]) => ({ l, z, want, got: n[key(li, z)] === undefined || n[key(li, z)] === "" ? null : +n[key(li, z)] })));
  const counted = diffs.every((d) => d.got !== null);
  const off = diffs.filter((d) => d.got !== null && d.got !== d.want);
  const short = off.some((d) => (d.got ?? 0) < d.want), over = off.some((d) => (d.got ?? 0) > d.want);
  const note = off.map((d) => `${d.l.label} ${d.z}: counted ${d.got} of ${d.want}`).join("\n");
  return (
    <div className="gc-form">
      <div className="gc-count">
        {lines.map((l, li) => (
          <div key={li} className="gc-count-l">
            <b>{l.label}</b>
            <div className="gc-count-sz">
              {Object.entries(l.sizes).sort(([a], [b]) => bySizeOrder(a, b)).map(([z, want]) => {
                const v = n[key(li, z)] ?? "", bad = v !== "" && +v !== want;
                return (
                  <label key={z} className={bad ? "bad" : v !== "" ? "ok" : ""}>
                    <span>{z === "OS" ? "Qty" : z}</span>
                    <input type="number" min={0} inputMode="numeric" value={v} placeholder={String(want)} onChange={(e) => setN({ ...n, [key(li, z)]: e.target.value })} aria-label={`${l.label} ${z} counted`} />
                    <small>of {want}</small>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn sm" onClick={() => setN(Object.fromEntries(lines.flatMap((l, li) => Object.entries(l.sizes).sort(([a], [b]) => bySizeOrder(a, b)).map(([z, want]) => [key(li, z), String(want)]))))}>Everything matches</button>
        <span className="faint" style={{ fontSize: 12.5 }}>{!counted ? "Type what you counted for each size (empty = not counted yet)." : off.length ? `${off.length} size${off.length === 1 ? " doesn't" : "s don't"} match. Saving marks it as an issue and tells the customer.` : "All counts match."}</span>
      </div>
      {counted && off.length > 0 && <pre className="gc-count-note">{note}</pre>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy || !counted} onClick={() => off.length ? onSave("issue", short && !over ? "short" : over && !short ? "over" : "other", `Counted in:\n${note}`) : onSave("received", "", "")}>{busy ? "Saving…" : off.length ? "Save and tell the customer" : "Counted in: all received"}</button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
